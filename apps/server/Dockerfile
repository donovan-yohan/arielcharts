FROM node:24-slim AS base
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
WORKDIR /app

# --- Dependencies ---
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY patches/ patches/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

# --- Build ---
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY apps/server/ apps/server/
RUN pnpm --filter @arielcharts/shared build && \
    pnpm --filter @arielcharts/server build
# pnpm deploy bundles the package with all resolved deps (no symlinks)
RUN pnpm deploy --filter @arielcharts/server --prod --legacy /app/deployed

# --- Runtime ---
FROM node:24-slim
WORKDIR /app

COPY --from=build /app/deployed/ ./

ENV NODE_ENV=production
ENV PORT=4000
ENV DATA_DIR=/data/arielcharts

EXPOSE 4000
CMD ["node", "dist/apps/server/src/index.js"]
