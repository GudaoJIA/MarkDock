# syntax=docker/dockerfile:1
FROM oven/bun:1.3.3 AS bun
FROM node:22.22.1-bookworm-slim AS build
WORKDIR /app
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN bun run build

FROM node:22.22.1-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
    MARKDOCK_HOST=0.0.0.0 PORT=3000 \
    MARKDOCK_DATA_DIR=/var/lib/markdock
RUN mkdir -p /var/lib/markdock /workspaces && chown node:node /var/lib/markdock /workspaces
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/.next/admin/auth-password.mjs ./admin/auth-password.mjs
COPY scripts/container-start.mjs scripts/healthcheck.mjs ./scripts/
COPY src/features/workspace/server/deployment.mjs ./src/features/workspace/server/deployment.mjs
COPY LICENSE ./LICENSE
USER 1000:1000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "scripts/healthcheck.mjs"]
CMD ["node", "scripts/container-start.mjs"]
