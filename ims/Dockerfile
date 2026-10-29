# syntax=docker/dockerfile:1.7
# Production image for IMS (spec §15.5): multi-stage, Next.js standalone output,
# runs as a non-root user. Development uses Dockerfile.dev.
#
#   docker build -t ims-web .                    # app server (default target)
#   docker build -t ims-migrate --target migrate .  # one-off migrations / admin bootstrap

ARG NODE_IMAGE=node:24-alpine

# --- 1. Dependencies (cached while package-lock.json is unchanged) ------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# --- 2. Build -----------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# --- 3. Migrations and admin bootstrap (has the Prisma CLI; never serves traffic)
FROM build AS migrate
ENV NODE_ENV=production
CMD ["npx", "prisma", "migrate", "deploy"]

# --- 4. Runtime ---------------------------------------------------------------
FROM ${NODE_IMAGE} AS web
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DOCUMENTS_DIR=/app/storage/documents
# The server only needs `node`: drop npm/npx/yarn (their bundled packages were the
# only HIGH findings in the image scan, and nothing at runtime uses them).
RUN apk add --no-cache libc6-compat tzdata \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && addgroup -S -g 1001 ims && adduser -S -u 1001 -G ims ims \
 && mkdir -p /app/storage/documents && chown -R ims:ims /app/storage
COPY --from=build --chown=ims:ims /app/.next/standalone ./
COPY --from=build --chown=ims:ims /app/.next/static ./.next/static
COPY --from=build --chown=ims:ims /app/public ./public
COPY --from=build --chown=ims:ims /app/assets ./assets
USER ims
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
