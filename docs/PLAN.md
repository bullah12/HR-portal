# HR Portal — Plan & Status

This document was reverse-engineered from the codebase (2026-07-19 audit). The
Prisma schema references a `docs/hr-portal-spec.md` that does not exist in the
repo; this file now serves as the documented spec and phase plan.

---

## 1. Product concept

An internal recruitment-to-onboarding platform for staff (recruiters, hiring
managers, interviewers, finance approvers, HR admins, DPO/auditors) covering
the full pipeline:

**Job postings → candidates → applications → CV parsing & ATS scoring →
interviews & scorecards → offers (sequential approval chain) → e-signature →
onboarding plans/tasks/documents.**

Cross-cutting concerns:

- **Auth & RBAC** — staff log in with email/password (HS256 JWT in an httpOnly
  cookie); `middleware.ts` enforces default-deny, role-per-method rules on
  every `/api` route and guards staff pages. Candidates/new hires are *not*
  user accounts — they act through tokenized public links (offer link,
  onboarding link).
- **Compliance** — GDPR consent records per candidate (application processing
  / talent pool, with expiry and withdrawal), an append-only audit log for
  human and system decisions (GDPR Art. 22 / EU AI Act framing), and bias
  controls (`maskedInRankingView`). ATS scoring is decision-support only;
  stage changes are human-recorded.
- **Integrations** — job-board multiposting (Broadbean-style aggregator),
  background checks (Zinc-style, webhook-driven), e-signature
  (DocuSign-style, webhook-driven), Microsoft 365 Graph calendar + Teams
  links, Slack notifications, transactional email templates.

Tech stack: Next.js 14 (App Router) + React 18 + Tailwind, Prisma 5 +
PostgreSQL, zod validation, jose (JWT), bcryptjs, pdfkit (offer letters),
pdf-parse + mammoth (CV text extraction). No migrations folder — the schema is
applied with `prisma db push`.

---

## 2. Data model (reverse-engineered from `prisma/schema.prisma`)

The schema contains **18 models** — the 13 core pipeline entities plus 5
supporting ones — and 18 enums.

### Core entities

| Entity | Purpose | Key relationships / constraints |
|---|---|---|
| `User` | Staff member (6 roles: HR_ADMIN, RECRUITER, HIRING_MANAGER, INTERVIEWER, FINANCE_APPROVER, DPO_AUDITOR). bcrypt password hash. | Owns jobs, sits on interview panels, writes scorecards, approves offers, owns onboarding tasks, appears as audit actor. |
| `Job` | Requisition with must-have / nice-to-have skill tags, min experience, comp band. Status: DRAFT → PENDING_APPROVAL → PUBLISHED → CLOSED. | `owner: User`; has applications and board postings. |
| `Candidate` | Person in the pipeline; source, consent status, `maskedInRankingView` bias control. | Unique email; has applications and consent records. |
| `Application` | One candidate applying to one job (unique pair — duplicate detection). Stage enum spans APPLIED → KNOCKOUT_FAILED / SCREENING / SHORTLISTED / INTERVIEW / OFFER / HIRED / REJECTED / WITHDRAWN. Score 0–100, knockout results JSON, rejection reason. | Hub entity: CVs, parse result, candidate score, interviews, offer, onboarding plan, background checks all hang off it. |
| `CVDocument` | Uploaded CV; only the storage key (`fileRef`) is stored, versioned per application. | Unique `(applicationId, version)`. |
| `ParseResult` | Parser output for one application: extracted fields JSON + score breakdown JSON + parser version. | One per application. |
| `Interview` | Scheduled interview (type, status, slot, video link, provider `calendarEventId`). | Many-to-many panelists (`User`); has scorecards. |
| `Scorecard` | One interviewer's structured feedback: ratings JSON (criterion → 1–5), recommendation (STRONG_YES…STRONG_NO), notes. | Unique `(interviewId, interviewerId)`. |
| `Offer` | Comp package for an application (validated against the job's band). Tracks approval state, e-signature status, candidate decision, expiry, and a secret `accessToken` for the public offer link; `esignEnvelopeId` links to the provider. | One per application; has sequential approvals. |
| `OfferApproval` | One step in the sequential approval chain (e.g. hiring manager → finance). | Unique `(offerId, sequence)`; approver is a `User`. |
| `OnboardingPlan` | Created on offer acceptance; start date, checklist template name, cached `progressPercent`, secret `accessToken` for the public onboarding link. | One per application; has tasks and documents. |
| `OnboardingTask` | Checklist item (category, status, due date, `requiresDocument`, optional `docRef`). | Owned by a staff `User`; may have linked documents. |
| `ConsentRecord` | GDPR consent trail per candidate (purpose, granted/withdrawn/expires). Never deleted — withdrawal is recorded. | Belongs to `Candidate`. |
| `AuditLog` | Append-only trail; polymorphic `entityType`+`entityId`; `actorId` null for system actions. | Optional actor `User`. |

### Supporting entities

| Entity | Purpose |
|---|---|
| `JobBoardPosting` | One posting of a job to one board via the aggregator; unique `(jobId, board)`, records external ref or error. |
| `CandidateScore` | Deterministic ATS score breakdown per application (must-have / nice-to-have / experience / location points, 40-point cap flag when a must-have is missing, matched/missing skill lists). Upserted on re-parse. |
| `OnboardingDocument` | Metadata for documents uploaded during onboarding (file lives in storage), optionally linked to a task; review status. |
| `BackgroundCheck` | A check ordered with the provider (package, external id, status REQUESTED → IN_PROGRESS → CLEAR/CONSIDER/FAILED via webhook). |
| `WebhookEvent` | Durable record of every inbound webhook delivery (payload, signature-verified flag, PENDING/PROCESSED/FAILED) so handlers ACK fast and events survive crashes. |

### Scoring rules (implemented in `services/cvParser/atsScorer.ts`)

Must-have skills 50 pts · nice-to-have 20 · experience fit 20 ·
location/eligibility 10; any missing must-have caps the total at 40.
Deterministic: same CV bytes + same job requirements ⇒ same score. Failed
knockouts are excluded before scoring.

---

## 3. What's already built — **Done**

### Foundation
- **Prisma schema** (18 models, 18 enums, indexes and uniqueness constraints
  as above).
- **Seed script** (`prisma/seed.ts`): 2 staff users, 3 jobs, 5 candidates
  spanning the full pipeline (hired with onboarding in progress, interview
  stage, shortlisted, rejected-with-cap, knockout-failed), including CVs,
  parse results, interviews, scorecards, an approved+signed offer, consent
  records, and audit entries.
- **Auth**: `POST /api/auth/login` / `logout`, HS256 JWTs (jose), httpOnly
  cookie, `app/login` page. `middleware.ts` does default-deny RBAC per route
  and HTTP method, strips and re-injects trusted `x-user-*` identity headers,
  guards staff pages, and whitelists public token routes (offer view/accept,
  onboarding tasks/documents) and vendor webhooks (HMAC-verified in-handler).

### Pages (all under `app/`)
`/login`, `/jobs`, `/jobs/new`, `/candidates`, `/candidates/[id]`,
`/interviews`, `/offers` (dual staff/candidate view via `?offer=&token=`),
`/onboarding/[token]` (public, tokenized). `/` redirects to `/jobs`.

**Audit verdict — pages are wired to real APIs, not mocks.** Every component
under `components/` fetches live data through `apiFetch` (`lib/client.ts`)
against the real API routes, which read/write PostgreSQL via Prisma. No
hard-coded placeholder data was found in any page or component.

### API routes (all under `app/api/`)
- `auth/login`, `auth/logout`, `users` (staff list for panel pickers)
- `jobs` (GET list w/ status filter + role scoping, POST create),
  `jobs/[id]/post-to-boards`
- `candidates` (GET/POST), `candidates/upload` (CV upload),
  `candidates/[id]/parse` (run parser/scorer),
  `candidates/[id]/background-check`
- `interviews` (GET list incl. scorecard counts, POST schedule w/ calendar
  event + conflict detection), `interviews/[id]/cancel`
- `offers` (GET/POST), `offers/[id]` (GET, staff or tokenized candidate),
  `offers/[id]/approvals` (sequential approval decisions),
  `offers/[id]/accept` (candidate accept/decline → HIRED, creates onboarding
  plan from a standard checklist, closes out other active applications),
  `offers/[id]/pdf` (pdfkit offer letter), `offers/[id]/send-for-signature`
- `onboarding/[candidateId]/tasks` (GET staff or tokenized candidate, PATCH),
  `onboarding/[candidateId]/documents` (GET/POST upload)
- `webhooks/backgroundCheck`, `webhooks/esign` — verify HMAC, persist
  `WebhookEvent`, ACK 202, process asynchronously.

### Services & lib
- `services/cvParser/` — **internal deterministic parser** (`index.ts`
  orchestrator, `fieldExtractor.ts`, `atsScorer.ts`): reads the stored CV,
  extracts text (pdf-parse / mammoth), extracts fields against a skill
  lexicon, scores per the weights above, and atomically persists ParseResult
  + CandidateScore + Application.score + audit entry. Idempotent re-parse.
  Note: seed data labels parse results "textkernel-…" but the live service is
  the internal one (`internal-ats-2.0.0`); no external parsing API is called.
- `lib/offers.ts`, `lib/onboarding.ts` — shared include shapes, DTO mapping,
  per-role visibility rules, dual staff/token access resolution.
- `lib/offerPdf.ts` (pdfkit), `lib/storage.ts` (local-disk file storage with
  path-traversal protection), `lib/email.ts` (transactional email templates —
  **render-only, see gaps**), `lib/calendar.ts`, `lib/auth.ts`,
  `lib/client.ts`, `lib/prisma.ts`, `lib/types.ts` (response envelope).
- `.env.example` documenting every required/optional env var.

### Integrations — audit verdict: **dual-mode, none hard-mocked, none verified against real providers**

Every integration follows the same pattern: **real HTTP calls when its env
vars are set, a deterministic local fallback when they are not.** The real
branches use `fetchWithRetry` (`lib/integrations/http.ts`: exponential
backoff on network errors / 429 / 5xx) and are written against plausible
provider APIs, but **none has been exercised against a real provider** — the
env vars are empty in `.env.example` and there is no evidence of live
credentials or recorded provider responses.

| Module | Real mode (env-gated) | Local fallback |
|---|---|---|
| `lib/integrations/jobBoards.ts` | POST to Broadbean aggregator (`BROADBEAN_*`) | Deterministic `local-<board>-<uuid>` refs; postings recorded either way |
| `lib/integrations/backgroundCheck.ts` | Order checks with Zinc (`ZINC_*`); webhook HMAC-SHA256 hex | `local-chk-…` ids; signature check skipped when no secret (recorded, not enforced) |
| `lib/integrations/esign.ts` | DocuSign envelope creation (`DOCUSIGN_*`); Connect webhook HMAC-SHA256 base64 | `local-env-…` envelope ids |
| `lib/calendar.ts` | MS Graph client-credentials flow, Teams meetings (`MS_GRAPH_*`) | Deterministic event ids + join links |
| `lib/integrations/slack.ts` | Incoming webhook (`SLACK_WEBHOOK_URL`), best-effort/never throws | Logs the message locally |
| `lib/email.ts` | **No real mode at all** — templates render only; SES delivery is explicitly deferred ("Phase 2b") and no email is ever sent | n/a |

---

## 4. What's missing or unverified

1. **No CI of any kind.** No `.github/workflows/`; nothing gates pushes on
   lint, typecheck, or build. Worse, **ESLint is not even installed** — there
   is no lint script, no eslint config, no eslint dependency. Only
   `npm run typecheck` and `npm run build` exist.
2. **Zero tests.** No test files, no test runner, no test script anywhere in
   the repo — including none for the compliance-sensitive paths (RBAC
   middleware, ATS scoring determinism/cap, offer approval sequencing,
   webhook signature verification).
3. **No deploy target.** No Dockerfile, no vercel/netlify/fly config, no
   deployment docs. Related: no Prisma migrations folder (`db push` only),
   which is fine for dev but not a production migration story; file storage
   is local-disk (S3 is aspirational comments only).
4. **README is a one-line stub** (`# HR-portal`). No setup, env, seed, run,
   or deploy instructions.
5. **Integrations unverified against real providers** — see verdict above:
   dual-mode by design, real branches never exercised. Email has **no** real
   branch: nothing in the product ever sends an email (interview
   confirmations, offer notifications are render-only previews).
6. **Functional gaps between schema and app:**
   - **Scorecards cannot be submitted through the app.** The model, seed
     data, and a read path (scorecard counts on `/api/interviews`) exist, but
     there is no submission endpoint or UI — interviewers have no way to file
     feedback.
   - **No audit-log viewer.** The `DPO_AUDITOR` role and `AuditLog` writes
     exist, but no page or API route exposes the log; the auditor role can't
     actually do anything in the app.
   - **No job lifecycle endpoints.** Jobs can be created (as DRAFT /
     PENDING_APPROVAL / PUBLISHED) but there is no edit, publish, or close
     endpoint after creation — `JobStatus.CLOSED` and the DRAFT→PUBLISHED
     transition are unreachable via the API.
   - Minor: no `GET /api/candidates/[id]` detail route — the profile page
     assembles its view from list endpoints.
7. **Referenced spec doc missing.** `prisma/schema.prisma` cites
   `docs/hr-portal-spec.md`, which is not in the repo (this PLAN.md now
   stands in for it).

---

## 5. Phased plan for what's left

Build order is chosen so every later phase lands behind a quality gate.

### Phase 1 — CI quality gate
- Add ESLint (`eslint` + `eslint-config-next`) and a `lint` script.
- GitHub Actions workflow on push/PR: install → `lint` → `typecheck` →
  `build` (with `prisma generate`).
- Exit criteria: red X on any push that fails lint, typecheck, or build.

### Phase 2 — Real README
- Setup (Node version, install, Postgres, `db push`, seed), full env-var
  reference (cross-linked to `.env.example`), seeded demo accounts, dev
  workflow (scripts), integration modes (local fallback vs. real-provider
  env vars), deploy steps (written in Phase 5, stubbed until then).

### Phase 3 — Close the schema ↔ app gaps
- Scorecard submission: `POST /api/interviews/[id]/scorecards` (interviewer
  must be a panelist; unique per interviewer) + submission UI on
  `/interviews`.
- Job lifecycle: `PATCH /api/jobs/[id]` (edit, publish, close, with audit
  entries) + UI actions.
- Audit-log viewer for `DPO_AUDITOR` / `HR_ADMIN`: `GET /api/audit-logs`
  (filter by entity/actor/date) + a simple page.
- Optional in this phase: `GET /api/candidates/[id]` detail route; wire email
  delivery (SES or SMTP) behind the same env-gated dual-mode pattern.

### Phase 4 — Tests on the pipeline's critical paths
- Test runner (Vitest) + CI integration (extend Phase 1 workflow).
- Unit: ATS scorer (weights, 40-cap, determinism), field extractor, webhook
  signature verification (both HMAC variants), auth token round-trip.
- Integration (against a test Postgres): application → parse →
  interview → scorecard → offer → sequential approvals → accept →
  onboarding-plan creation + competing-application close-out; RBAC
  middleware rules (default-deny, token routes); webhook event
  persistence/processing.
- Exit criteria: critical-path suite green in CI.

### Phase 5 — Deploy target + steps
- Pick a target (e.g. Vercel + managed Postgres, or Docker on Fly/Render).
- Introduce real Prisma migrations (`migrate deploy`) instead of `db push`
  for production; decide the file-storage story (S3 or a mounted volume).
- Document deploy + rollback in the README; add secrets/env checklist.
- Exit criteria: documented, repeatable deploy of the seeded app.

### Phase 6 — Hardening & deferred items (post-MVP)
- Verify each integration against its real provider (or explicitly descope);
  enforce webhook signatures in production config.
- Production auth story (the code comments assume Auth0 SSO/MFA later),
  queue-based webhook processing (SQS per the code's comments), consent
  expiry/retention automation, and the bias-masked ranking view the schema's
  `maskedInRankingView` flag anticipates.

---

*Phases 1–5 are the committed scope; Phase 6 is a parking lot so deferred
intentions stay visible.*
