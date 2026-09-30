FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN NODE_OPTIONS=--max-old-space-size=4096 pnpm build && pnpm prune --prod

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=4310 HOST=0.0.0.0 DATA_DIR=/data XDG_CACHE_HOME=/tmp/.cache
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/shared ./shared
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/licenses ./licenses
COPY --from=build --chown=node:node /app/infra/render/start-app.sh ./infra/render/start-app.sh
RUN node node_modules/playwright/cli.js install --with-deps --only-shell chromium && chmod -R a+rX /opt/playwright && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:4310/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "server/index.ts"]
