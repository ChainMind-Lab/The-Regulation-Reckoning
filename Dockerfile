# ── Build stage ───────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Optional build-time backend base URL. Empty (the default) makes the app call
# the same origin, which is what the bundled nginx /api proxy expects.
ARG VITE_API_URL=""
ENV VITE_API_URL=${VITE_API_URL}

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────
FROM nginx:1.27-alpine

# Security headers + /api proxy to the backend service (docker-compose network).
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Run nginx as an unprivileged user (nginx image convention).
USER nginx

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:80/ >/dev/null || exit 1