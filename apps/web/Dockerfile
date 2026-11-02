# syntax=docker/dockerfile:1
# Build context is the repository root:  docker build -f apps/web/Dockerfile .

FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    HUSKY=0 \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1
# Node 25+ images no longer bundle Corepack, so pnpm is installed directly. Keep the version equal
# to "packageManager" in package.json (scripts/dockerfile-pnpm.test.mjs enforces it).
ARG PNPM_VERSION=12.3.4
RUN npm install --global "pnpm@${PNPM_VERSION}"
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @dpt/web...

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/ui packages/ui
COPY apps/web apps/web
RUN pnpm --filter @dpt/web build

# Next's standalone output keeps the monorepo layout: the server lives at apps/web/server.js.
FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS runtime
ARG IMAGE_SOURCE=https://github.com/blaquetribe/deal-pipeline-tracker
LABEL org.opencontainers.image.source=${IMAGE_SOURCE} \
      org.opencontainers.image.title="dpt-web"
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
# The runtime needs only node. The package managers bundled in the base image carry
# their own dependency CVEs (flagged by Trivy) and are an unneeded attack surface.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
           /usr/local/bin/corepack /opt/yarn*
COPY --from=build --chown=1000:1000 /repo/apps/web/.next/standalone ./
COPY --from=build --chown=1000:1000 /repo/apps/web/.next/static ./apps/web/.next/static
# Numeric UID/GID of the image's built-in `node` user, so orchestrators can verify non-root.
USER 1000:1000
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["wget", "-q", "--spider", "http://127.0.0.1:3000/"]
CMD ["node", "apps/web/server.js"]
