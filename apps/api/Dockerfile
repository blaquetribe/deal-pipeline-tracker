# syntax=docker/dockerfile:1
# Build context is the repository root:  docker build -f apps/api/Dockerfile .

FROM node:26-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    HUSKY=0 \
    CI=true
# Node 25+ images no longer bundle Corepack, so pnpm is installed directly. Keep the version equal
# to "packageManager" in package.json (scripts/dockerfile-pnpm.test.mjs enforces it).
ARG PNPM_VERSION=12.3.4
RUN npm install --global "pnpm@${PNPM_VERSION}"
WORKDIR /repo

# Install with only the manifests copied, so source changes do not bust this layer.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @dpt/api...

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @dpt/api build

# The bundle is self-contained, so the runtime image has no node_modules and no pnpm.
FROM node:26-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS runtime
ARG IMAGE_SOURCE=https://github.com/blaquetribe/deal-pipeline-tracker
LABEL org.opencontainers.image.source=${IMAGE_SOURCE} \
      org.opencontainers.image.title="dpt-api"
ENV NODE_ENV=production \
    PORT=3001
WORKDIR /app
# The runtime needs only node. The package managers bundled in the base image carry
# their own dependency CVEs (flagged by Trivy) and are an unneeded attack surface.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
           /usr/local/bin/corepack /opt/yarn*
COPY --from=build --chown=1000:1000 /repo/apps/api/dist ./dist
# Numeric UID/GID of the image's built-in `node` user, so orchestrators can verify non-root.
USER 1000:1000
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["wget", "-q", "--spider", "http://127.0.0.1:3001/health"]
CMD ["node", "dist/index.js"]
