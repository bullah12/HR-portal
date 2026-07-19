# Prompts for Fable — HR Portal build-out

How to use this file: paste **one phase at a time**, in order, as a new
message to Fable in the *same* project/session so it can see prior work.
Wait for each phase's proof checklist to come back clean before sending the
next — don't queue multiple phases at once. This keeps each request small
and lets you catch a wrong turn after one phase instead of five.

Two rules that save the most tokens across a multi-phase build:
1. **Point at the doc, don't paste the doc.** Every prompt below assumes
   `docs/PLAN.md` is in the repo. Reference section numbers instead of
   re-explaining the product each time.
2. **Cap the ask.** Each prompt has an explicit Scope, an explicit
   "Do NOT" line, and a proof checklist. An AI builder left open-ended will
   happily generate 3x the code you asked for.

Phase order matters: Phase 1 (CI) goes first so every later phase lands
behind a red/green gate.

---

## Phase 1 — CI quality gate

```
Read docs/PLAN.md §6-§7 — this is Phase 1 of the HR Portal roadmap.
The repo currently has NO lint tooling and NO CI at all.

Scope for this phase (Phase 1 only):
- Add ESLint: eslint + eslint-config-next, an .eslintrc config matching
  the existing code style, and a "lint" script in package.json. Fix any
  lint errors the existing code surfaces (or, where a rule fights the
  existing style, configure the rule — state which you did).
- Add a GitHub Actions workflow (.github/workflows/ci.yml) that runs on
  every push and pull request: install deps → prisma generate →
  npm run lint → npm run typecheck → npm run build.
- The build must not require a live database or any real integration
  credentials — everything is env-gated already; keep it that way.

Do NOT: add tests or a test runner (Phase 4), don't touch the README
(Phase 2), don't refactor application code beyond what lint fixes
require, don't add formatting tools (Prettier) unless lint setup forces
a decision — and if so, say why.

Proof checklist — when done, give me:
1. Confirmation that `npm run lint`, `npm run typecheck`, and
   `npm run build` all pass locally, with output summaries.
2. A link to (or the run status of) the first green CI run on the branch.
3. A list of any lint rules you disabled/configured and why.
```

---

## Phase 2 — Real README

```
Continuing HR Portal (docs/PLAN.md §7 Phase 2). Phase 1's CI gate is
green. The current README is a one-line stub.

Scope:
- Rewrite README.md with: project overview (2-3 paragraphs, link to
  docs/PLAN.md for the full spec); prerequisites (Node version, Postgres);
  setup steps (install, .env from .env.example, prisma db push, seed);
  the seeded demo accounts and their roles (from prisma/seed.ts — include
  the demo passwords, they are dev-only); the npm scripts table; an
  "integration modes" section explaining the dual-mode pattern from
  PLAN.md §5 (local fallback when env vars unset, real provider when
  set, and that real branches are unverified — see PLAN.md's callout);
  a "Deployment" section that says "see Phase 5" as a stub.
- Verify the setup steps actually work by running them in order against
  a clean database before writing them down.

Do NOT: change any application code, add badges/logos/screenshots, or
document features that don't exist yet (scorecard submission, audit
viewer — those are Phase 3; the README must describe the app as it IS).

Proof checklist — when done, give me:
1. Confirmation you executed the documented setup steps end-to-end
   (fresh DB → push → seed → dev server → log in with a seeded account).
2. The README section list so I can sanity-check coverage.
3. Confirmation CI is still green.
```

---

## Phase 3 — Close the schema ↔ app gaps

```
Continuing HR Portal (docs/PLAN.md §7 Phase 3; §6 point 6 lists the
gaps; §8 Q3/Q6/Q10 have the resolved decisions). Phases 1-2 are done.

Scope:
- Scorecard submission: POST /api/interviews/[id]/scorecards — caller
  must be a panelist on that interview (or HR_ADMIN), one scorecard per
  (interview, interviewer) per the schema's unique constraint, ratings
  as criterion→1-5 map, recommendation enum, audit entry on submit. Add
  a middleware RBAC rule for it (default-deny, remember). UI: submission
  form on /interviews for interviews the current user paneled, and
  display of existing scorecards.
- Job lifecycle: PATCH /api/jobs/[id] supporting edit of core fields
  plus status transitions (DRAFT→PENDING_APPROVAL→PUBLISHED→CLOSED,
  setting publishedAt/closedAt), role-restricted per middleware
  conventions, audit entry per change. UI actions on /jobs.
- Audit-log viewer: GET /api/audit-logs (filters: entityType, actorId,
  date range; paginated) restricted to DPO_AUDITOR + HR_ADMIN, plus a
  simple /audit page. Note DPO_AUDITOR currently has NO page access —
  extend middleware page rules accordingly.
- Email delivery: wire lib/email.ts rendered templates to actually send
  via SMTP (nodemailer) behind env vars (SMTP_* unset = log the rendered
  email, same dual-mode pattern as other integrations, per PLAN.md §8
  Q6). Send on: interview scheduled, offer sent for signature, offer
  accepted. Update .env.example.
- One-line fix: update the prisma/schema.prisma header comment to point
  at docs/PLAN.md instead of the nonexistent docs/hr-portal-spec.md
  (PLAN.md §8 Q10).

Do NOT: build a separate admin area (PLAN.md §8 Q3 — extend existing
pages), don't add tests yet (Phase 4), don't touch deploy config, don't
redesign existing UI, don't add the optional GET /api/candidates/[id]
route unless a UI change in this phase needs it.

Proof checklist — when done, give me:
1. CI green (lint + typecheck + build).
2. A manual walkthrough transcript against the seeded DB: submit a
   scorecard as the hiring manager on James's technical interview;
   publish then close the draft HR Ops job; view the audit page as a
   DPO_AUDITOR user (create one via seed or script — say which); trigger
   one email in local mode and paste the logged output.
3. The list of new middleware rules added (route + methods + roles).
```

---

## Phase 4 — Tests on the pipeline's critical paths

```
Continuing HR Portal (docs/PLAN.md §7 Phase 4; §8 Q8 resolved the test
stack: Vitest). Phases 1-3 are done.

Scope:
- Add Vitest + a "test" script; wire it into the existing CI workflow
  (after typecheck, before build is fine).
- Unit tests (no DB): ATS scorer — weights, the missing-must-have
  40-point cap, determinism (same input twice ⇒ identical output), the
  knockout-exclusion contract; fieldExtractor skill/experience
  extraction; both webhook HMAC verifiers (hex + base64 variants,
  including the "no secret configured" recorded-not-enforced path);
  JWT sign/verify round-trip incl. expiry rejection.
- Integration tests against a disposable Postgres (docker-compose
  service in CI; document the local equivalent): the full happy path —
  create application → upload CV → parse → schedule interview → submit
  scorecard → create offer → sequential approvals (incl. out-of-order
  rejection) → candidate accept via token → assert HIRED, onboarding
  plan created from the standard checklist, competing applications
  closed, audit entries written. Plus: middleware RBAC (default-deny on
  an unruled route; role denial; public token routes) and webhook event
  persistence → async processing → status transition.
- Keep tests hermetic: local/dev integration modes only, no real
  provider calls.

Do NOT: add Playwright/e2e (deferred per PLAN.md §8 Q8), don't refactor
production code except where a genuine testability blocker exists —
flag any such refactor in your summary. Do NOT chase coverage numbers;
the named paths above are the scope.

Proof checklist — when done, give me:
1. Full test run output (counts: files, tests, pass/fail) locally AND
   the green CI run including the new test job.
2. Which named scenarios from the scope are covered by which test files.
3. Any production-code changes made for testability, with justification.
```

---

## Phase 5 — Deploy target + steps

```
Continuing HR Portal (docs/PLAN.md §7 Phase 5; §8 Q5/Q7/Q9 have the
resolved decisions: Docker on Render/Fly + managed Postgres + persistent
volume for uploads; real Prisma migrations; webhook secrets required in
prod). Phases 1-4 are done.

Scope:
- Dockerfile (multi-stage, standalone Next.js output) + .dockerignore;
  the container must run migrations on release, not on boot
  (document the release command).
- Introduce Prisma migrations: baseline the current schema as the
  initial migration; switch production guidance to `prisma migrate
  deploy` while keeping `db push` for local dev (PLAN.md §8 Q5).
- Pick ONE concrete platform (Render or Fly — your call, justify
  briefly), and write the deploy config for it (render.yaml or
  fly.toml), mounting a persistent volume at the upload dirs.
- README "Deployment" section (replacing the Phase 2 stub): step-by-step
  first deploy, migration/release flow, rollback, and a production env
  checklist — explicitly requiring AUTH_SECRET (generated, not the
  example value) and ZINC_WEBHOOK_SECRET / DOCUSIGN_WEBHOOK_SECRET per
  PLAN.md §8 Q9.
- Verify locally: docker build succeeds and the container serves the app
  against a local Postgres with migrations applied.

Do NOT: move file storage to S3 (stays a Phase 6 item — the volume
covers it per PLAN.md §8 Q7), don't add real provider credentials,
don't set up the actual cloud account/deploy if credentials aren't
available — deliver config + docs and say exactly what I must run.

Proof checklist — when done, give me:
1. Local proof: docker build output summary + a successful request
   against the running container (login page + one authenticated API
   call via a seeded account).
2. `prisma migrate deploy` output against a fresh database.
3. The production env checklist, and CI still green.
```

---

## Phase 6 — Hardening & deferred items (run selectively)

```
Continuing HR Portal (docs/PLAN.md §7 Phase 6 — the parking lot; §5's
integration table and the §8 resolutions apply). Phases 1-5 are done.
This phase is selective: I'll tell you which items to run; treat each
bullet as independently skippable.

Scope (only the items I name when I send this):
- Integration verification: for each provider I supply sandbox
  credentials for (Broadbean/Zinc/DocuSign/MS Graph/Slack/SMTP),
  exercise the real branch end-to-end, fix contract mismatches, and
  record the verified request/response shapes in a docs note. For any
  provider I don't supply credentials for, mark it "local mode only" in
  the README instead — do not invent credentials or hit production APIs
  speculatively.
- Startup warning when webhook secrets are unset outside development
  (PLAN.md §8 Q9).
- Consent-expiry automation: a scheduled job that flags/expires
  ConsentRecords past expiresAt and audits the transition.
- Bias-masked ranking view: candidate list/ranking hides name, photo,
  age, address when maskedInRankingView is set, per the schema's intent.
- (Larger, only on explicit go:) Auth0 fronting, SQS-based webhook
  processing, S3 storage.

Do NOT: start any bullet I haven't named, don't upgrade framework/major
dependencies as a side quest, and stop immediately and report if a
provider sandbox behaves differently than the code assumes rather than
patching around it silently.

Proof checklist — when done, give me:
1. Per item run: what changed, and the concrete evidence it works (real
   provider round-trip logs for verifications; before/after behaviour
   for the others).
2. Updated README/PLAN.md notes for anything verified or descoped.
3. CI green, tests green.
```

---

## General prompting tips for the rest of the build

- If a phase's response drifts into a later phase's scope, say so and ask
  for a revert/hold — cheaper than letting it compound.
- Report bugs between phases as their own short message ("scorecard form
  500s on submit") rather than re-pasting a phase prompt.
- Keep `docs/PLAN.md` as the single edit point when requirements change:
  edit the doc, then tell Fable "PLAN.md §X changed, re-read it."
