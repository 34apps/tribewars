# syntax=docker/dockerfile:1
# Clanfire game server image (linux/arm64 on t4g, also builds on amd64). The web client is NOT in this image (it goes to S3).
ARG NODE_VERSION=26

FROM node:${NODE_VERSION}-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/
# The lockfile lists every workspace, so their package.json files must exist for `npm ci`; only the server's deps are installed.
COPY apps/web/package.json apps/web/
COPY apps/preview/package.json apps/preview/
RUN npm ci --workspace @clanfire/server --include-workspace-root=false --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/engine packages/engine
COPY apps/server apps/server
# The advisor embeds the game rules at build time.
COPY docs/GAME_DESIGN.md docs/GAME_DESIGN.md
RUN npm run build -w @clanfire/server

FROM node:${NODE_VERSION}-slim
WORKDIR /app
ENV NODE_ENV=production \
    DATABASE_PATH=/data/clanfire.sqlite \
    BACKUP_DIR=/data/backups \
    HOST=0.0.0.0 \
    PORT=3000
COPY --from=build /app/apps/server/dist ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "index.js"]
