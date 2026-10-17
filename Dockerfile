# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY tsconfig.json prisma.config.ts vite.config.mjs index.html ./
COPY src ./src
COPY server ./server
COPY scripts/prepare-sites-build.mjs ./scripts/prepare-sites-build.mjs
COPY worker ./worker
COPY .openai ./.openai
RUN npm run db:generate && npm run typecheck && npm run build && npm run build:api

FROM build AS runtime-deps
RUN npm prune --omit=dev --ignore-scripts

FROM node:24-bookworm-slim AS api
ENV NODE_ENV=production TZ=Asia/Shanghai API_HOST=0.0.0.0 API_PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=runtime-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server/dist ./server/dist
USER node
EXPOSE 3000
CMD ["node", "server/dist/main.js"]

# Run migrations explicitly during the approved maintenance window, never on API startup.
FROM node:24-bookworm-slim AS migrate
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production TZ=Asia/Shanghai
WORKDIR /app
COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/prisma.config.ts ./
COPY --from=build --chown=node:node /app/server/prisma/schema.prisma ./server/prisma/schema.prisma
COPY --from=build --chown=node:node /app/server/prisma/migrations ./server/prisma/migrations
COPY --from=build --chown=node:node /app/server/dist ./server/dist
USER node
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

# Backup credentials are isolated from the application image at runtime. This
# image only contains the COS transfer tools; pg_dump remains in PostgreSQL.
FROM node:24-bookworm-slim AS backup-tool
ENV NODE_ENV=production TZ=Asia/Shanghai
WORKDIR /app
COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=runtime-deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node scripts/upload-backup.mjs scripts/download-backup.mjs ./scripts/
USER 10001:10001
CMD ["node", "scripts/upload-backup.mjs"]

# Personal low-cost deployment: Caddy serves the SPA and obtains HTTPS
# certificates automatically after DNS and ICP filing are ready.
FROM caddy:2-alpine AS personal-web
COPY --from=build /app/dist/client /srv
COPY deploy/personal/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443

FROM nginx:stable-alpine AS web
COPY --from=build /app/dist/client /usr/share/nginx/html
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY deploy/security-headers.conf /etc/nginx/security-headers.conf
EXPOSE 80 443
