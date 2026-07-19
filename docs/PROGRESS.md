# HR Portal — Build Progress Log

Running log of the unattended end-to-end build (docs/PLAN.md §7 roadmap,
prompts in docs/FABLE_PROMPTS.md). Updated after every phase.

## Phase status

| Phase | Deliverable | Status | Proof | Deviation from PLAN.md |
|---|---|---|---|---|
| 1 | CI quality gate (ESLint + GitHub Actions) | ✅ green | see Phase 1 proof below | none |
| 2 | Real README | ⏳ pending | — | — |
| 3 | Close schema ↔ app gaps | ⏳ pending | — | — |
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
- CI run status: recorded after first push (see PR).
