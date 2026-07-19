# Multi-stage build producing a self-contained Next.js standalone image.
#
# Migrations run on RELEASE, not on boot: the deploy pipeline runs
#   npx prisma migrate deploy
# in this image (Fly release_command, see fly.toml) before new machines
# start. The app process itself never touches the schema.

# --- deps: full install for building --------------------------------------
FROM node:20-slim AS deps
WORKDIR /app
RUN apt-get update -qq && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# Optional corporate-proxy CA: docker build --secret id=build_ca,src=<ca.pem>
# No-op when the secret is not provided.
RUN --mount=type=secret,id=build_ca,target=/tmp/build-ca.crt \
    sh -c 'if [ -s /tmp/build-ca.crt ]; then export NODE_EXTRA_CA_CERTS=/tmp/build-ca.crt; fi; npm ci'

# --- build: prisma client + standalone Next bundle ------------------------
FROM node:20-slim AS build
WORKDIR /app
RUN apt-get update -qq && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# DATABASE_URL/AUTH_SECRET are build-time placeholders only — `next build`
# never contacts a database; real values arrive at runtime.
RUN --mount=type=secret,id=build_ca,target=/tmp/build-ca.crt \
    DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    AUTH_SECRET="build-time-placeholder-secret" \
    sh -c 'if [ -s /tmp/build-ca.crt ]; then export NODE_EXTRA_CA_CERTS=/tmp/build-ca.crt; fi; npx prisma generate && npm run build'

# --- runner ---------------------------------------------------------------
FROM node:20-slim AS runner
WORKDIR /app
RUN apt-get update -qq && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* \
  && groupadd --system nodejs && useradd --system --gid nodejs nextjs

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma CLI + engines + schema/migrations so the release command
# (`npx prisma migrate deploy`) runs offline inside this same image.
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/prisma ./node_modules/prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
RUN mkdir -p node_modules/.bin && ln -sf ../prisma/build/index.js node_modules/.bin/prisma

# Upload dirs live under /app/uploads — mount the persistent volume here
# (CV_UPLOAD_DIR / ONBOARDING_UPLOAD_DIR stay at their relative defaults).
RUN mkdir -p /app/uploads/cv /app/uploads/onboarding && chown -R nextjs:nodejs /app/uploads

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
