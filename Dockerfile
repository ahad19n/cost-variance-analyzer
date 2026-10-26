# ---- deps: install production dependencies only ----
FROM node:24-slim AS deps
# Toolchain for compiling better-sqlite3 if no prebuilt binary matches; stays in this stage only.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime ----
FROM node:24-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/app.db
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY views ./views
COPY public ./public
COPY scripts/seed.js scripts/docker-entrypoint.sh ./scripts/
COPY sample-data/valid.csv ./sample-data/valid.csv

# Run as the unprivileged "node" user; only the data directory is writable.
RUN mkdir -p /app/data && chown node:node /app/data && chmod +x scripts/docker-entrypoint.sh
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
