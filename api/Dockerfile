# ---------------------------------------------------------------------------
# family-dash API
#
# Multi-stage so the runtime image carries production dependencies and
# compiled JavaScript only. Alpine on node:22 has arm64 images, so this
# builds for a Raspberry Pi as well as a dev machine:
#   docker buildx build --platform linux/amd64,linux/arm64 .
# ---------------------------------------------------------------------------

FROM node:22-alpine AS base
WORKDIR /app
# tini reaps zombies and forwards SIGTERM, so `docker compose down` reaches
# the clean-shutdown handler in Application.ts instead of being killed.
RUN apk add --no-cache tini
ENV NODE_ENV=production


# --- dependencies ----------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --include=dev


# --- development: hot reload under tsx -------------------------------------
FROM base AS development
ENV NODE_ENV=development
RUN apk add --no-cache curl
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json tsconfig.test.json vitest.config.mts eslint.config.js ./
COPY scripts ./scripts
COPY config ./config
COPY lib ./lib
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "run", "dev"]


# --- build -----------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY scripts ./scripts
COPY lib ./lib
RUN npm run build


# --- production ------------------------------------------------------------
FROM base AS production

# Install production dependencies only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/build ./build
COPY config ./config

# The media volume is mounted here; create it so an unmounted run still
# starts and the media health check reports a clear reason.
RUN mkdir -p /media/photos /media/thumbs /media/drawings \
  && chown -R node:node /media /app

USER node
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "build/index.js"]
