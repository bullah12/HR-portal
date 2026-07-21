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
| `ines.moreau@acme-corp.example` | `Audit0r!Demo` | DPO_AUDITOR |

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
| `npm test` | Vitest unit + integration tests (see Testing) |

CI (`.github/workflows/ci.yml`) runs install → `prisma generate` → lint →
typecheck → test (against a disposable Postgres service container) →
build on every push and pull request; no credentials are needed.

## Testing

Unit tests (scorer, extractor, webhook HMACs, JWT) need no database.
Integration tests (full pipeline, RBAC middleware, webhook processing)
run against a **disposable** Postgres database — they wipe it on every
run, so never point them at your dev database. Local equivalent of the CI
service container:

```bash
# one-time: create the throwaway DB next to your dev one
docker exec hr-portal-pg psql -U postgres -c 'create database hr_portal_test'
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/hr_portal_test?schema=public" \
  npx prisma db push --skip-generate

# run everything (unit + integration)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/hr_portal_test?schema=public" \
  npm test
```

Tests are hermetic: all integrations run in local dev mode and webhook
payloads are signed locally (`tests/setup.ts` strips any provider env
vars).

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
| Email (SMTP via nodemailer) | `SMTP_HOST/PORT/USER/PASS`, `EMAIL_FROM` | Rendered email logged to the server console |

CV and onboarding uploads go to local disk (`CV_UPLOAD_DIR`,
`ONBOARDING_UPLOAD_DIR`).

> **Note:** every provider above is currently **local mode only**: the
> real (env-set) branches are written against plausible provider APIs but
> have **never been exercised with live credentials** (docs/PLAN.md
> callout + §7 Phase 6). Do not set the real-mode env vars in production
> until the branch has been verified against a sandbox account. Outside
> development, the server logs a startup **security warning** when
> `ZINC_WEBHOOK_SECRET` / `DOCUSIGN_WEBHOOK_SECRET` are unset, because
> unsigned webhooks would be accepted.

### Scheduled jobs

Consent expiry (GDPR): `npm run consents:expire` flags candidates whose
every active consent record is past `expiresAt` (status → `EXPIRED`,
audited as a system action; records are never deleted). Run it daily via
cron, or on Fly:
`fly machine run . --schedule daily -- npm run consents:expire`.

## Deployment

Target: **Docker on Fly.io** with a managed Postgres and a persistent
volume for uploads (docs/PLAN.md §8 Q7 — local-disk uploads rule out
serverless without an S3 rewrite; a container + volume ships with zero
storage-code changes). Config lives in `Dockerfile` + `fly.toml`.

### Schema management

Production uses real Prisma migrations (`prisma/migrations/`, baselined
from the current schema): the release step runs `npx prisma migrate
deploy` **before** new machines start (`[deploy].release_command` in
fly.toml) — the app process never touches the schema at boot. Local dev
keeps `prisma db push`. When you change `prisma/schema.prisma`, create a
migration with `npx prisma migrate dev --name <change>` so prod stays
reviewable.

### First deploy

```bash
fly launch --no-deploy --copy-config          # registers the app, keeps fly.toml
fly postgres create --name hr-portal-db --region fra
fly postgres attach hr-portal-db              # sets DATABASE_URL secret
fly volumes create hr_portal_uploads --region fra --size 10

# Secrets (see the checklist below)
fly secrets set AUTH_SECRET="$(openssl rand -base64 48)"
fly secrets set ZINC_WEBHOOK_SECRET="…" DOCUSIGN_WEBHOOK_SECRET="…"
fly secrets set APP_BASE_URL="https://<your-app>.fly.dev"

fly deploy                                    # build → release (migrate deploy) → start
```

Seed demo data only if you want it in that environment:
`fly ssh console -C "npx prisma db seed"` (requires ts-node — run the
seed from a dev machine against the prod `DATABASE_URL` instead, or skip).

### Releases & rollback

- Every `fly deploy` builds the image, runs `npx prisma migrate deploy`
  as the release command, and only then swaps machines. A failing
  migration aborts the release; the old version keeps serving.
- Roll back the app with `fly releases` + `fly deploy --image <previous image ref>`.
  Migrations are forward-only — write an explicit down/compensating
  migration rather than restoring an old image on top of a newer schema.
- Uploads live on the `hr_portal_uploads` volume and survive deploys;
  `fly volumes snapshots list` for backups.

### Production env checklist

| Variable | Requirement |
|---|---|
| `DATABASE_URL` | Set by `fly postgres attach` (managed Postgres) |
| `AUTH_SECRET` | **Required.** Freshly generated (`openssl rand -base64 48`) — never the .env.example value |
| `ZINC_WEBHOOK_SECRET` | **Required in production** (PLAN.md §8 Q9) — unsigned webhooks must not be accepted |
| `DOCUSIGN_WEBHOOK_SECRET` | **Required in production** (PLAN.md §8 Q9) |
| `APP_BASE_URL` | Public https URL of the deployment (used in candidate links) |
| `CV_UPLOAD_DIR` / `ONBOARDING_UPLOAD_DIR` | Leave at defaults (`uploads/…`) — the volume mounts at `/app/uploads` |
| `MS_GRAPH_*`, `BROADBEAN_*`, `ZINC_API_*`, `DOCUSIGN_*` (non-secret), `SLACK_WEBHOOK_URL`, `SMTP_*` | Optional — each enables its real integration; unset = local mode (unverified live, see Integration modes) |
