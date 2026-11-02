# Build context: repository root (npm workspaces share one package-lock.json).
FROM node:22.16.0-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
# Root postinstall runs `prisma generate`, so the schema must exist before install.
COPY backend/prisma backend/prisma
RUN npm ci --workspace backend --include-workspace-root
COPY backend backend
# The demo seed reads the simulation policy from docs/config.
COPY docs/config docs/config
# Reviewed guidance corpus of the AI business assistant (read at startup).
COPY docs/ai-corpus docs/ai-corpus
RUN npm run build --workspace backend

FROM node:22.16.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
# The Prisma CLI (dev dependency) is kept for `migrate deploy` and the demo seed.
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/.local && chown node:node /app/.local
USER node
WORKDIR /app/backend
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/main.js"]
