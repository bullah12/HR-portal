# HR Portal — Build Progress Log

Running log of the unattended end-to-end build (docs/PLAN.md §7 roadmap,
prompts in docs/FABLE_PROMPTS.md). Updated after every phase.

## Phase status

| Phase | Deliverable | Status | Proof | Deviation from PLAN.md |
|---|---|---|---|---|
| 1 | CI quality gate (ESLint + GitHub Actions) | ✅ green | see Phase 1 proof below | none |
| 2 | Real README | ✅ green | see Phase 2 proof below | none |
| 3 | Close schema ↔ app gaps | ✅ green | see Phase 3 proof below | none |
| 4 | Tests on critical paths | ⏳ pending | — | — |
| 5 | Deploy target + steps | ⏳ pending | — | — |
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
