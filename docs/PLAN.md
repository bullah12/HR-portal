# HR Portal — Recruitment-to-Onboarding Platform

An internal hiring platform covering the full pipeline from job posting to
first-day onboarding, with GDPR consent tracking and an append-only audit
log throughout.

This document was reverse-engineered from the codebase (2026-07-19 audit) —
the project was built without a committed spec. The Prisma schema references
a `docs/hr-portal-spec.md` that was never committed; this file now serves as
the documented spec and phase plan. Phase prompts live in
`docs/FABLE_PROMPTS.md`.

> **⚠️ INTEGRATIONS ARE UNVERIFIED AGAINST REAL PROVIDERS**
> Every third-party integration (Broadbean, Zinc, DocuSign, MS Graph, Slack)
> is dual-mode: real HTTP calls when its env vars are set, a deterministic
> local fallback when they are not. The real branches are written against
> plausible provider APIs but have **never been exercised with live
> credentials** — treat them as untested until Phase 6 verifies each one.
> Email has no real branch at all: templates render, nothing ever sends.

---

## 1. Product Concept

**Elevator pitch:** a single internal app where recruiters publish jobs and
multipost them to boards, candidates flow through applied → screened →
interviewed → offered → hired, CVs are parsed and ATS-scored
deterministically, offers run through a sequential approval chain and
e-signature, and accepted candidates land in a tokenized onboarding
checklist — with every human/system decision written to an audit log and
candidate consent tracked for GDPR.

**Users:** staff only (6 roles: HR_ADMIN, RECRUITER, HIRING_MANAGER,
INTERVIEWER, FINANCE_APPROVER, DPO_AUDITOR). Candidates and new hires are
**not** user accounts — they act through secret tokenized links (public
offer view/accept link, public onboarding link).

### Core features
1. **Jobs** — requisitions with must-have / nice-to-have skill tags, comp
   bands, status lifecycle (DRAFT → PENDING_APPROVAL → PUBLISHED → CLOSED),
   and one-click multiposting to job boards via an aggregator.
2. **Candidates & applications** — one application per (candidate, job)
   pair (duplicate detection), knockout questions, pipeline stages, source
   tracking, bias control (`maskedInRankingView`).
3. **CV parsing & ATS scoring** — deterministic in-house parser: extract
   text (PDF/DOCX) → extract fields → weighted score against the job's
   requirement tags. Decision-support only; stage changes stay
   human-recorded (GDPR Art. 22 / EU AI Act framing).
4. **Interviews & scorecards** — scheduling with panel conflict detection,
   calendar events + Teams links, per-interviewer structured scorecards.
5. **Offers** — comp validated against the job's band, sequential approval
   chain (e.g. hiring manager → finance), offer-letter PDF, e-signature,
   candidate accept/decline via tokenized link; acceptance auto-creates the
   onboarding plan and closes out competing applications.
6. **Onboarding** — checklist plans from a standard template, task
   ownership, document upload/review, public candidate link, progress %.
7. **Compliance** — per-candidate consent records (purpose, expiry,
   withdrawal — never deleted), append-only polymorphic audit log,
   HMAC-verified vendor webhooks persisted durably before processing.

### Explicit non-features (current scope)
- No candidate self-service accounts (tokenized links only; Auth0 SSO/MFA
  is a code-comment aspiration, not scope).
- No ML anywhere — scoring is a deterministic weighted rubric by design.
- No multi-tenancy; one company ("Acme Corp" branding in the offer PDF).

---

## 2. Tech Stack (as built)

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js 14 (App Router, TypeScript)** | UI + API routes in one repo; middleware for RBAC |
| Styling | **Tailwind CSS** | No component library |
| Database | **PostgreSQL via Prisma 5** | No migrations folder — schema applied with `prisma db push` |
| Auth | **Custom HS256 JWT (jose) + bcryptjs**, httpOnly cookie | Signed with `AUTH_SECRET`; issued by `POST /api/auth/login` |
| Validation | **zod** | Request bodies |
| PDFs | **pdfkit** (offer letters), **pdf-parse + mammoth** (CV text) | |
| File storage | **Local disk** (`CV_UPLOAD_DIR`, `ONBOARDING_UPLOAD_DIR`) | S3 SSE-KMS is comment-ware only |
| Integrations | Dual-mode HTTP clients w/ retry (`lib/integrations/http.ts`) | See callout above |
| Testing | **None** | Gap — see §6/§7 |
| CI / deploy | **None** | Gap — see §6/§7 |

---

## 3. Data Model (reverse-engineered from `prisma/schema.prisma`)

**18 models** — 13 core pipeline entities plus 5 supporting — and 18 enums.

### Core entities

| Entity | Purpose | Key relationships / constraints |
|---|---|---|
| `User` | Staff member (6 roles). bcrypt password hash. | Owns jobs, sits on interview panels, writes scorecards, approves offers, owns onboarding tasks, appears as audit actor. |
| `Job` | Requisition: skill tags, min experience, comp band, status lifecycle. | `owner: User`; has applications and board postings. |
| `Candidate` | Person in the pipeline; source, consent status, `maskedInRankingView`. | Unique email; has applications and consent records. |
| `Application` | One candidate × one job (unique pair). Stage: APPLIED → KNOCKOUT_FAILED / SCREENING / SHORTLISTED / INTERVIEW / OFFER / HIRED / REJECTED / WITHDRAWN. Score 0–100, knockout JSON, rejection reason. | Hub entity: CVs, parse result, candidate score, interviews, offer, onboarding plan, background checks hang off it. |
| `CVDocument` | Uploaded CV; storage key only, versioned per application. | Unique `(applicationId, version)`. |
| `ParseResult` | Parser output: extracted fields JSON + score breakdown JSON + parser version. | One per application. |
| `Interview` | Type, status, slot, video link, provider `calendarEventId`. | Many-to-many panelists (`User`); has scorecards. |
| `Scorecard` | One interviewer's feedback: ratings JSON (criterion → 1–5), recommendation (STRONG_YES…STRONG_NO), notes. | Unique `(interviewId, interviewerId)`. |
| `Offer` | Comp package; approval state, signature status, candidate decision, expiry, secret `accessToken` (public link), `esignEnvelopeId`. | One per application; has sequential approvals. |
| `OfferApproval` | One step in the sequential approval chain. | Unique `(offerId, sequence)`; approver is a `User`. |
| `OnboardingPlan` | Created on acceptance; start date, checklist template, cached `progressPercent`, secret `accessToken` (public link). | One per application; has tasks and documents. |
| `OnboardingTask` | Checklist item: category, status, due date, `requiresDocument`, optional `docRef`. | Owned by a staff `User`; may have linked documents. |
| `ConsentRecord` | GDPR consent per candidate (purpose, granted/withdrawn/expires). Never deleted. | Belongs to `Candidate`. |
| `AuditLog` | Append-only; polymorphic `entityType`+`entityId`; `actorId` null for system actions. | Optional actor `User`. |

### Supporting entities

| Entity | Purpose |
|---|---|
| `JobBoardPosting` | One posting of a job to one board; unique `(jobId, board)`; external ref or error. |
| `CandidateScore` | Deterministic ATS score breakdown per application; 40-point-cap flag; matched/missing skill lists. Upserted on re-parse. |
| `OnboardingDocument` | Metadata for onboarding uploads, optionally linked to a task; review status. |
| `BackgroundCheck` | Provider-ordered check (package, external id); REQUESTED → IN_PROGRESS → CLEAR / CONSIDER / FAILED via webhook. |
| `WebhookEvent` | Durable record of every inbound webhook (payload, signature-verified flag, PENDING/PROCESSED/FAILED). |

---

## 4. ATS Scoring Engine (implemented in `services/cvParser/`)

Pure and deterministic, no ML:

```
must-have skills   50 pts  (proportional to matched/required)
nice-to-have       20 pts
experience fit     20 pts
location/eligibility 10 pts
any missing must-have  →  total capped at 40 (capApplied flag)
failed knockouts       →  excluded before scoring, score stays null
```

Same CV bytes + same job requirements ⇒ same score. Re-parse upserts
(idempotent) and writes ParseResult + CandidateScore + Application.score +
an audit entry atomically.

---

## 5. What's Already Built — **Done**

### Foundation
- **Prisma schema** — all of §3, with indexes and uniqueness constraints.
- **Seed script** (`prisma/seed.ts`) — 2 staff users, 3 jobs, 5 candidates
  spanning the full pipeline (hired + onboarding in progress, interview
  stage, shortlisted, rejected-with-cap, knockout-failed), incl. CVs, parse
  results, interviews, scorecards, an approved+signed offer, consent
  records, audit entries.
- **Auth & RBAC** — `POST /api/auth/login` / `logout`, HS256 JWT in an
  httpOnly cookie, `app/login` page. `middleware.ts`: default-deny
  role-per-method rules on every `/api` route, trusted `x-user-*` header
  injection (client-supplied values stripped), staff page guards, public
  token-route and webhook whitelists.

### Pages — **audit verdict: wired to real APIs, not mocks**
`/login`, `/jobs`, `/jobs/new`, `/candidates`, `/candidates/[id]`,
`/interviews`, `/offers` (dual staff/candidate view via `?offer=&token=`),
`/onboarding/[token]` (public), `/` → `/jobs`. Every component fetches live
data through `apiFetch` (`lib/client.ts`) against real API routes backed by
Prisma/PostgreSQL. **No placeholder/mock data exists anywhere in the UI.**

### API routes
- `auth/login`, `auth/logout`, `users`
- `jobs` (GET w/ status filter + role scoping, POST), `jobs/[id]/post-to-boards`
- `candidates` (GET/POST), `candidates/upload`, `candidates/[id]/parse`,
  `candidates/[id]/background-check`
- `interviews` (GET incl. scorecard counts, POST w/ calendar event +
  conflict detection), `interviews/[id]/cancel`
- `offers` (GET/POST), `offers/[id]` (staff or tokenized), 
  `offers/[id]/approvals`, `offers/[id]/accept` (→ HIRED, creates
  onboarding plan from standard checklist, closes competing applications),
  `offers/[id]/pdf`, `offers/[id]/send-for-signature`
- `onboarding/[candidateId]/tasks` (GET staff/tokenized, PATCH),
  `onboarding/[candidateId]/documents` (GET/POST)
- `webhooks/backgroundCheck`, `webhooks/esign` — HMAC verify, persist
  `WebhookEvent`, ACK 202, process async.

### Services & lib
- `services/cvParser/` — internal deterministic parser + scorer (§4).
  Note: seed rows are labelled "textkernel-…" but the live service is the
  internal one (`internal-ats-2.0.0`); no external parsing API is called.
- `lib/offers.ts`, `lib/onboarding.ts` — include shapes, DTOs, per-role
  visibility, dual staff/token access resolution.
- `lib/offerPdf.ts`, `lib/storage.ts` (local disk, path-traversal safe),
  `lib/email.ts` (**render-only**), `lib/calendar.ts`, `lib/auth.ts`,
  `lib/client.ts`, `lib/prisma.ts`, `lib/types.ts`.
- `.env.example` documenting every env var.

### Integrations — **audit verdict: dual-mode, none hard-mocked, none verified live**

| Module | Real mode (env-gated) | Local fallback |
|---|---|---|
| `lib/integrations/jobBoards.ts` | Broadbean aggregator POST (`BROADBEAN_*`) | Deterministic `local-<board>-<uuid>` refs |
| `lib/integrations/backgroundCheck.ts` | Zinc check ordering (`ZINC_*`); webhook HMAC-SHA256 hex | `local-chk-…` ids; signature skipped w/o secret (recorded, not enforced) |
| `lib/integrations/esign.ts` | DocuSign envelopes (`DOCUSIGN_*`); Connect webhook HMAC-SHA256 base64 | `local-env-…` envelope ids |
| `lib/calendar.ts` | MS Graph client-credentials + Teams meetings (`MS_GRAPH_*`) | Deterministic event ids + join links |
| `lib/integrations/slack.ts` | Incoming webhook, best-effort/never throws | Logs the message |
| `lib/email.ts` | **No real mode** — SES deferred; nothing sends | n/a |

---

## 6. What's Missing or Unverified

1. **No CI of any kind.** No `.github/workflows/`. **ESLint is not even
   installed** — no lint script, config, or dependency. Only
   `npm run typecheck` and `npm run build` exist.
2. **Zero tests.** No test files, runner, or script — including for the
   compliance-sensitive paths (RBAC middleware, scoring cap/determinism,
   approval sequencing, webhook signatures).
3. **No deploy target.** No Dockerfile / platform config / docs. No Prisma
   migrations (`db push` only). File storage is local disk.
4. **README is a one-line stub** (`# HR-portal`).
5. **Integrations unverified live** (see §5 callout); email never sends.
6. **Schema ↔ app gaps:**
   - **Scorecards cannot be submitted through the app** — model, seed data,
     and a read path (counts) exist; no submission endpoint or UI.
   - **No audit-log viewer** — `DPO_AUDITOR` role and log writes exist; no
     page or route exposes the log.
   - **No job lifecycle endpoints** — jobs can only be created;
     `CLOSED` and the DRAFT→PUBLISHED transition are unreachable via API.
   - Minor: no `GET /api/candidates/[id]` detail route (profile page
     assembles its view from list endpoints).
7. **Referenced spec doc missing** — `prisma/schema.prisma` cites
   `docs/hr-portal-spec.md`; this PLAN.md now stands in for it.

---

## 7. Phased Build Roadmap

Each phase is independently shippable and independently promptable (one
prompt per phase in `docs/FABLE_PROMPTS.md`). Build order puts the quality
gate first so every later phase lands behind it.

| Phase | Deliverable | Depends on |
|---|---|---|
| **1** | **CI quality gate**: add ESLint (+ `lint` script) and a GitHub Actions workflow running install → lint → typecheck → build (with `prisma generate`) on every push/PR | — |
| **2** | **Real README**: setup (Node, install, Postgres, `db push`, seed), env-var reference, seeded demo accounts, dev workflow, integration modes (local vs real), deploy section stubbed until Phase 5 | 1 |
| **3** | **Close schema ↔ app gaps**: scorecard submission (API + UI), job lifecycle `PATCH /api/jobs/[id]` (edit/publish/close + audit), audit-log viewer for DPO_AUDITOR/HR_ADMIN, optional candidate-detail route + env-gated email delivery | 1 |
| **4** | **Tests on critical paths**: Vitest in CI; unit (scorer, extractor, webhook HMACs, JWT round-trip); integration against test Postgres (application → parse → interview → scorecard → offer → approvals → accept → onboarding; RBAC rules; webhook persistence) | 1, 3 |
| **5** | **Deploy target + steps**: pick target, introduce real Prisma migrations (`migrate deploy`), decide file-storage story, document deploy/rollback + secrets checklist in README | 1–4 |
| **6** | **Hardening & deferred** (parking lot): verify each integration against its real provider or descope, enforce webhook signatures in prod, production auth (Auth0 per code comments), queued webhook processing (SQS), consent-expiry automation, bias-masked ranking view | 5 |

Exit criteria per phase are written into the prompts in
`docs/FABLE_PROMPTS.md` as proof checklists.

---

## 8. Open Questions — all RESOLVED with recommended answers

1. **Are MS Graph / Broadbean / Zinc / DocuSign / Slack real integrations
   or dev-mode stubs when env vars are unset?**
   **RESOLVED — dual-mode, confirmed from `.env.example` comments and the
   code.** Each module makes real HTTP calls (with retry/backoff) when its
   env vars are set and falls back to a deterministic local mode when
   unset; `.env.example` documents exactly this per provider ("when unset,
   a local development mode simulates…"). None is a hard mock — but no real
   branch has ever run against a live provider. Recommendation: keep the
   dual-mode pattern as-is; verify each real branch with sandbox
   credentials in Phase 6, and until then state "local mode" in the README.

2. **What auth model?**
   **RESOLVED — custom HS256 JWT, confirmed.** `AUTH_SECRET` signs JWTs
   (jose) issued by `POST /api/auth/login`; the token lives in an httpOnly
   cookie, and `middleware.ts` enforces default-deny RBAC per route/method.
   Code comments say production will front this with Auth0 (EU tenant,
   SSO/MFA). Recommendation: keep the custom JWT through Phases 1–5 — it
   works end-to-end and is testable; treat Auth0 as Phase 6, and rotate
   `AUTH_SECRET` guidance into the README.

3. **Is a separate admin UI needed for offer approvals?**
   **RESOLVED — no.** The staff view of `/offers` already renders approval
   actions (`OfferCard` posts decisions to `/api/offers/[id]/approvals`,
   which enforces the caller is the pending approver in sequence). What IS
   missing is not approvals but **scorecard submission** and an
   **audit-log viewer** — both scoped into Phase 3. Recommendation: extend
   existing pages rather than building a separate admin area.

4. **Is the CV parser meant to be an external service (Textkernel)?**
   **RESOLVED — no, the internal parser is the product.** Seed data labels
   parse results "textkernel-extract-4.2.x" (legacy of the aspirational
   spec), but the only implemented parser is the deterministic in-house one
   (`internal-ats-2.0.0`), and determinism is a stated design goal.
   Recommendation: keep the internal parser; treat the seed labels as
   cosmetic and leave them (they exercise the "parser version varies"
   display path).

5. **Migration story: keep `prisma db push`?**
   **RESOLVED — keep for dev, switch for prod.** `db push` is fine until
   deploy; Phase 5 introduces a baseline migration and `prisma migrate
   deploy` for production so schema changes become reviewable and
   reversible.

6. **Should email delivery be wired, and when?**
   **RESOLVED — yes, in Phase 3.** Templates already render
   (interview confirmations, offer notifications); wire delivery behind the
   same env-gated dual-mode pattern as the other integrations (SMTP or SES;
   unset = log the rendered email). Without this, candidates never actually
   receive interview/offer communication.

7. **Deploy target?**
   **RESOLVED — recommend Docker on Render/Fly with a managed Postgres and
   a persistent volume.** Rationale: uploads are written to local disk
   (`CV_UPLOAD_DIR`, `ONBOARDING_UPLOAD_DIR`), which breaks on serverless
   (Vercel) without first building S3 storage. A container + volume ships
   with zero storage-code changes; S3 remains a Phase 6 upgrade. If Vercel
   is strongly preferred, S3 storage must move into Phase 5 scope.

8. **Test stack?**
   **RESOLVED — Vitest** for unit + integration (against a disposable
   Postgres via docker-compose or Testcontainers in CI). Playwright e2e is
   optional later; the critical-path integration suite in Phase 4 gives
   most of the value at far lower cost.

9. **Webhook signature enforcement in dev?**
   **RESOLVED — keep current behaviour, flag in prod.** Today an unset
   webhook secret means signatures are recorded but not enforced (dev
   convenience). Keep that, but Phase 5's deploy checklist must require
   `ZINC_WEBHOOK_SECRET` / `DOCUSIGN_WEBHOOK_SECRET` in production, and
   Phase 6 adds a startup warning when they're unset outside development.

10. **What replaces the missing `docs/hr-portal-spec.md`?**
    **RESOLVED — this document.** Update the schema comment to point at
    `docs/PLAN.md` during Phase 3 (one-line change, bundled with that
    phase's schema-adjacent work).
