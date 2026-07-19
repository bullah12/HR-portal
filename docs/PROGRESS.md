# HR Portal — Build Progress Log

Running log of the unattended end-to-end build (docs/PLAN.md §7 roadmap,
prompts in docs/FABLE_PROMPTS.md). Updated after every phase.

## Phase status

| Phase | Deliverable | Status | Proof | Deviation from PLAN.md |
|---|---|---|---|---|
| 1 | CI quality gate (ESLint + GitHub Actions) | ✅ green | see Phase 1 proof below | none |
| 2 | Real README | ✅ green | see Phase 2 proof below | none |
| 3 | Close schema ↔ app gaps | ✅ green | see Phase 3 proof below | none |
| 4 | Tests on critical paths | ✅ green | 58/58 tests pass, see Phase 4 proof | none |
| 5 | Deploy target + steps | ✅ green | see Phase 5 proof below | none |
| 6 | Hardening & deferred | ⏳ pending | — | — |

## Decisions

- **Postgres runs in Docker** (`postgres:16` container, port 5432), matching
  `DATABASE_URL` in `.env.example`, per the run instructions.
- **ESLint config:** `.eslintrc.json` extending `next/core-web-vitals` with
  **zero rule overrides** — the existing codebase lints clean against the
  default ruleset, so nothing was disabled or configured. No Prettier
  (nothing forced the decision, per the Phase 1 "Do NOT" line).
- **CI env:** the workflow sets placeholder `DATABASE_URL` / `AUTH_SECRET`
  values; no live DB or provider credential is required at build time (all
  integrations stay env-gated).

### Phase 3 decisions

- **DPO_AUDITOR demo user added via seed** (`prisma/seed.ts`, not a
  one-off script): `ines.moreau@acme-corp.example` / `Audit0r!Demo`.
- **Scorecards route also has a GET** (list per interview) — required for
  the "display of existing scorecards" UI; reads are panel-scoped for
  HMs/interviewers, mirroring GET /api/interviews.
- **Job status transitions are forward-only**: DRAFT→{PENDING_APPROVAL,
  PUBLISHED, CLOSED}, PENDING_APPROVAL→{PUBLISHED, CLOSED},
  PUBLISHED→{CLOSED}; CLOSED is terminal and read-only. DRAFT→PUBLISHED
  directly is allowed because POST /api/jobs can already create a job as
  PUBLISHED.
- **DPO_AUDITOR home is /audit**: login and the middleware role-fallback
  redirect DPO users there (they have no recruiting pages).
- **Email delivery never throws** — pipeline actions must not fail on a
  notification error; the delivery outcome is written into the audit
  detail instead.

### Phase 5 decisions

- **Platform: Fly.io** (over Render). Rationale: first-class
  `release_command` (migrations run on release, never on boot), simple
  named-volume mounts for the upload dirs, and an eu-central region
  (fra) matching the EU data-residency framing. Config in `fly.toml`.
- **Volume mounts at `/app/uploads`** and the upload-dir env vars stay at
  their relative defaults — the storage code resolves them against cwd
  (`/app` in the image), so no storage-code change was needed (PLAN.md §8
  Q7 intent preserved).
- **Prisma CLI ships inside the runner image** (node_modules/prisma +
  @prisma) so `npx prisma migrate deploy` runs offline as the release
  command; `.bin/prisma` is recreated as a symlink because COPY
  dereferences it.
- **Dockerfile accepts an optional `build_ca` BuildKit secret** for
  corporate-proxy CAs during `npm ci`/`prisma generate` (a no-op when not
  provided). This sandbox's egress proxy required it; normal builds don't.
- **Single machine** (`min_machines_running = 1`, no scale-out) because
  uploads are on a local volume.

### Phase 4 decisions

- **CI disposable Postgres = GitHub Actions `services:` container**
  (postgres:16), the Actions-native equivalent of a docker-compose
  service; the local equivalent (`hr_portal_test` DB in the same Docker
  Postgres) is documented in the README's Testing section.
- **Integration tests call route handlers directly** (constructing
  requests with the x-user-* identity headers middleware would inject)
  rather than booting a Next server; the middleware itself is tested
  separately by invoking the exported `middleware()` with real signed
  JWTs. Faster, hermetic, and covers the same contracts.
- **No production code was changed for testability** — zero refactors
  needed.

## Blocked / needs me

- Nothing blocked. For go-live later: real credentials for MS Graph,
  Broadbean, Zinc, DocuSign, Slack (Phase 6 verification) — until then all
  integrations run in local dev mode.

## How to run locally

```bash
# 1. Postgres (Docker)
docker run -d --name hr-portal-pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=hr_portal -p 5432:5432 postgres:16

# 2. Install + env
npm install
cp .env.example .env   # set AUTH_SECRET to any long random string

# 3. Schema + seed
npx prisma generate
npx prisma db push
npx prisma db seed

# 4. Run
npm run dev            # http://localhost:3000
```

Log in with a seeded account (dev-only passwords, from prisma/seed.ts):
- `sofia.lindqvist@acme-corp.example` / `Recruit3r!Demo` (RECRUITER)
- `marcus.weber@acme-corp.example` / `Hiring!Demo42` (HIRING_MANAGER)

---

## Proof log

### Phase 1 — CI quality gate ✅

Commands run locally (2026-07-19):

```
$ npm run lint
✔ No ESLint warnings or errors

$ npm run typecheck
(tsc --noEmit — exit 0, no output)

$ npm run build
 ✓ Compiled successfully
 ✓ Generating static pages (21/21)
```

- Added: `eslint@8` + `eslint-config-next@14.2.21` devDependencies,
  `.eslintrc.json` (`next/core-web-vitals`, no overrides), `lint` script,
  `.github/workflows/ci.yml` (push + PR: npm ci → prisma generate → lint →
  typecheck → build).
- Lint rules disabled/configured: **none** — existing code passed the
  default Next ruleset unchanged.
- Note during build: `/api/users` logs a Next.js "Dynamic server usage"
  info line during static-page generation — expected for a header-reading
  route, not an error; build exits 0.
- CI run status: **green** — run #1 `completed / success`
  (https://github.com/bullah12/HR-portal/actions/runs/29673061981), commit
  6b52271. PR: https://github.com/bullah12/HR-portal/pull/7

### Phase 2 — Real README ✅

Setup steps executed end-to-end against a clean database before writing
them down (2026-07-19):

```
$ psql ... -c 'drop database hr_portal' -c 'create database hr_portal'
$ npx prisma db push          # ✔ schema applied, client generated
$ npx prisma db seed          # 🌱 seed executed (users, jobs, candidates…)
$ npm run dev                 # server up on :3000
$ curl http://localhost:3000/login                    → 200
$ curl -X POST /api/auth/login (sofia.lindqvist…)     → success:true, JWT issued
$ curl /api/jobs (with auth cookie)                   → seeded jobs returned
```

README section list: Overview (3 paras, links to PLAN.md) / Prerequisites /
Setup / Seeded demo accounts / npm scripts / Integration modes (dual-mode
table + unverified-live callout) / Deployment (Phase 5 stub).

No application code changed. CI still green at the Phase 1 commit; Phase 2
run recorded on push.

### Phase 3 — Close the schema ↔ app gaps ✅

Local gate: `npm run lint` ✔ no warnings/errors; `npm run typecheck` ✔;
`npm run build` ✔ Compiled successfully, 23/23 pages.

Manual walkthrough against the seeded DB (2026-07-19, all via curl on the
dev server):

```
# Scorecard as Marcus Weber (HIRING_MANAGER, panelist) on James's
# TECHNICAL interview:
POST /api/interviews/cmrramslz…/scorecards
  {ratings:{technical_depth:4,problem_solving:5,communication:4},
   recommendation:"YES"}                     → 201, scorecard created
POST again (duplicate)                       → 409 ALREADY_SUBMITTED

# Job lifecycle as Sofia (RECRUITER) on the DRAFT "HR Operations
# Specialist" job:
PATCH /api/jobs/cmrramski… {"status":"PUBLISHED"} → PUBLISHED, publishedAt set
PATCH … {"status":"CLOSED"}                       → CLOSED, closedAt set
PATCH … {"status":"PUBLISHED"} (reopen)           → 422 INVALID_TRANSITION

# Audit view as Inès Moreau (DPO_AUDITOR — created via SEED):
GET /api/audit-logs?pageSize=5   → total 14, incl. job.status_changed ×2,
                                   scorecard.submitted, actor names shown
GET /audit (page)                → 200
GET /api/audit-logs as Marcus (HIRING_MANAGER) → 403 (default-deny holds)
GET /api/audit-logs?entityType=Job             → 4 entries (filter works)

# Email in local mode (SMTP_* unset) — scheduling Priya's phone screen:
POST /api/interviews → 201, emailDelivery {"mode":"local","delivered":false}
server log:
  [email:local] To: priya.sharma@mail.example
  [email:local] Subject: Your phone screen for Frontend Engineer
  [email:local] When: Saturday, 25 July 2026, 10:00–10:30 (UTC) …
```

New middleware rules (API, default-deny preserved):
- `/api/interviews/[id]/scorecards` — GET + POST: HR_ADMIN, RECRUITER,
  HIRING_MANAGER, INTERVIEWER (handler additionally enforces
  panelist-or-HR_ADMIN on POST and panel-scoping on GET)
- `/api/jobs/[id]` — PATCH: HR_ADMIN, RECRUITER
- `/api/audit-logs` — GET: HR_ADMIN, DPO_AUDITOR

New page rule: `/audit` — HR_ADMIN, DPO_AUDITOR (matcher extended;
DPO_AUDITOR fallback redirect → /audit).

Also in this phase: email delivery wired (nodemailer, SMTP_* env-gated,
sends on interview scheduled / offer sent for signature / offer accepted;
.env.example updated), schema header comment now points at docs/PLAN.md,
README demo-accounts + integration table refreshed.

### Phase 4 — Tests on the critical paths ✅

Local run (2026-07-19), `DATABASE_URL` → hr_portal_test:

```
 Test Files  7 passed (7)
      Tests  58 passed (58)
   Duration  ~3.7s
```

Scenario → file coverage:
- ATS scorer weights / 40-point cap / determinism / synonym matching /
  skill ranking → `tests/unit/atsScorer.test.ts`
- fieldExtractor skills (lexicon + synonyms + whole-word), experience
  (explicit years + merged date ranges), contact/education/location →
  `tests/unit/fieldExtractor.test.ts`
- Webhook HMAC verifiers: Zinc hex + DocuSign base64, incl. the
  no-secret recorded-not-enforced path and tamper rejection →
  `tests/unit/webhookSignatures.test.ts`
- JWT sign/verify round-trip, expiry rejection, wrong-secret/tampered/
  invalid-role rejection → `tests/unit/auth.test.ts`
- Full happy path (application → CV upload → parse [idempotent, cap
  check] → knockout exclusion → interview [local calendar, conflict
  detection] → scorecard [panelist-only, duplicate 409] → offer
  [comp-band validation] → sequential approvals [out-of-order 409] →
  token accept → HIRED + standard 6-task onboarding plan + competing
  application REJECTED + audit entries) →
  `tests/integration/pipeline.test.ts`
- Middleware RBAC: default-deny unruled route, role denial, method
  denial, identity-header injection + client-header stripping, public
  token routes, webhook pass-through →
  `tests/integration/rbac.test.ts`
- Webhook persistence → async processing → BackgroundCheck transition
  (CLEAR/CONSIDER), bad-signature 401 with nothing persisted,
  unknown-check FAILED event, dev-mode unsigned acceptance →
  `tests/integration/webhooks.test.ts`

Production-code changes for testability: **none**.
Gate re-run after wiring tests into CI: lint ✔, typecheck ✔, build ✔
(23/23 pages). CI now: install → generate → lint → typecheck → db push →
test (Postgres service) → build.

### Phase 5 — Deploy target + steps ✅

Local proof (2026-07-19):

```
$ docker build --secret id=build_ca,src=… -t hr-portal:local .
build exit: 0        # multi-stage, standalone output

# Release step — migrations from INSIDE the image, fresh hr_portal_prod DB:
$ docker run --rm -e DATABASE_URL=… hr-portal:local npx prisma migrate deploy
migrations/
  └─ 20260719000000_init/  └─ migration.sql
All migrations have been successfully applied.

# Serving:
$ docker run -d -p 3100:3000 -e DATABASE_URL=… -e AUTH_SECRET=… hr-portal:local
$ curl localhost:3100/login                        → 200
$ POST /api/auth/login (sofia.lindqvist…)          → success:true, JWT issued
$ GET /api/jobs (auth cookie)                      → seeded jobs returned
```

Also verified from the host: `prisma migrate deploy` against a fresh
database applies the baseline cleanly (hr_portal_deploy_check).

Deliverables: `Dockerfile` (multi-stage, standalone, non-root, Prisma CLI
included for the release command), `.dockerignore`,
`prisma/migrations/20260719000000_init/` (baselined from the schema) +
`migration_lock.toml`, `fly.toml` (release_command = migrate deploy,
volume at /app/uploads, fra region), README "Deployment" section
(first deploy, release/rollback flow, production env checklist requiring
generated AUTH_SECRET + both webhook secrets per PLAN.md §8 Q9),
`output: 'standalone'` in next.config.js.

Gate after all changes: lint ✔ · typecheck ✔ · tests 58/58 ✔ · build ✔.
Not done (needs your accounts): the actual `fly launch/deploy` — README
documents the exact commands.
