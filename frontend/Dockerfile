# Build context: repository root (npm workspaces share one package-lock.json).
FROM node:22.16.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
# Scripts are skipped: the root postinstall generates the backend Prisma client.
RUN npm ci --workspace frontend --include-workspace-root --ignore-scripts
COPY frontend frontend
COPY docs/config/hrtp-ui-tokens.json docs/config/
RUN npm run build --workspace frontend

FROM nginx:1.28-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
