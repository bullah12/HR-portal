# HR Portal

An internal recruitment-to-onboarding platform: recruiters publish jobs and
multipost them to job boards, candidates move through the pipeline
(applied → screening → interview → offer → hired), CVs are parsed and
ATS-scored by a deterministic in-house engine, offers run through a
sequential approval chain and e-signature, and accepted candidates land in
a tokenized onboarding checklist. Every human and system decision is
written to an append-only audit log, and candidate consent is tracked for
GDPR.

Staff log in with one of six roles (HR_ADMIN, RECRUITER, HIRING_MANAGER,
INTERVIEWER, FINANCE_APPROVER, DPO_AUDITOR); candidates and new hires are
not accounts — they act through secret tokenized links (offer accept link,
onboarding checklist link). The stack is Next.js 14 (App Router,
TypeScript) with Tailwind, PostgreSQL via Prisma 5, custom HS256 JWT auth
in an httpOnly cookie, and default-deny RBAC enforced in `middleware.ts`.

The full spec — data model, screens, API surface, scoring rubric, and the
phased roadmap — lives in [docs/PLAN.md](docs/PLAN.md). Build progress and
proofs are logged in [docs/PROGRESS.md](docs/PROGRESS.md).

## Prerequisites

- **Node.js 20+** (CI runs on Node 20; Node 22 works)
- **PostgreSQL 16** — easiest via Docker (below), any reachable Postgres
  matching `DATABASE_URL` works

## Setup

```bash
# 1. Start Postgres (matches the default DATABASE_URL in .env.example)
docker run -d --name hr-portal-pg \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=hr_portal \
  -p 5432:5432 postgres:16

# 2. Install dependencies
npm install

# 3. Environment
cp .env.example .env
# then edit .env: set AUTH_SECRET to a long random string
# (openssl rand -base64 48). Leave the integration vars unset — see
# "Integration modes" below.

# 4. Apply the schema and seed demo data
npx prisma db push        # also runs prisma generate
npx prisma db seed

# 5. Run the dev server
npm run dev               # http://localhost:3000
```

There is no migrations folder yet — the schema is applied with
`prisma db push` (a baseline migration arrives with the deploy phase, see
docs/PLAN.md §7 Phase 5).

## Seeded demo accounts

Dev-only credentials created by `prisma/seed.ts`:

| Email | Password | Role |
|---|---|---|
| `sofia.lindqvist@acme-corp.example` | `Recruit3r!Demo` | RECRUITER |
| `marcus.weber@acme-corp.example` | `Hiring!Demo42` | HIRING_MANAGER |

The seed also creates 3 jobs and 5 candidates spanning the whole pipeline
(one hired with onboarding in progress, one at interview stage with
scorecards, one shortlisted, one rejected via the scoring cap, one
knockout-failed), including CVs, parse results, an approved + signed
offer, consent records, and audit entries — so every screen has real data
after seeding.

## npm scripts

| Script | What it does |
|---|---|
| `npm run dev` | Next.js dev server on :3000 |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint (`next/core-web-vitals`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:push` | Apply `prisma/schema.prisma` to the database |
| `npm run db:seed` | Seed demo data (also `npx prisma db seed`) |

CI (`.github/workflows/ci.yml`) runs install → `prisma generate` → lint →
typecheck → build on every push and pull request; no database or
credentials are needed at build time.

## Integration modes

Every third-party integration is **dual-mode**: it makes real HTTP calls
when its env vars are set and falls back to a deterministic local dev mode
when they are unset. With a bare `.env` (only `DATABASE_URL` +
`AUTH_SECRET`), the entire app works offline:

| Integration | Env vars | Local mode when unset |
|---|---|---|
| Job board multiposting (Broadbean) | `BROADBEAN_API_URL/KEY` | Simulated postings with `local-<board>-<uuid>` refs |
| Background checks (Zinc) | `ZINC_API_URL/KEY`, `ZINC_WEBHOOK_SECRET` | `local-chk-…` ids; webhook signature recorded but not enforced without the secret |
| E-signature (DocuSign) | `DOCUSIGN_*` | `local-env-…` envelope ids |
| Calendar + Teams links (MS Graph) | `MS_GRAPH_*` | Deterministic event ids and join links |
| Slack notifications | `SLACK_WEBHOOK_URL` | Messages logged to the server console |
| Email | — | Templates render; nothing is sent (no real branch exists yet) |

CV and onboarding uploads go to local disk (`CV_UPLOAD_DIR`,
`ONBOARDING_UPLOAD_DIR`).

> **Note:** the real (env-set) branches are written against plausible
> provider APIs but have **never been exercised with live credentials** —
> treat them as unverified until the hardening phase checks each one
> (docs/PLAN.md, callout at the top and §7 Phase 6).

## Deployment

Not yet defined — arrives with Phase 5 of the roadmap (docs/PLAN.md §7):
Docker image, real Prisma migrations, and a concrete platform config.
