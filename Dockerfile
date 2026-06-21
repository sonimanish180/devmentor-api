# Development image for devmentor-api.
# Optimized for the inner-loop (hot reload), NOT production — a hardened
# multi-stage production build is added in Phase 14.
FROM node:20-alpine

WORKDIR /app

# pnpm ships with Node via corepack.
RUN corepack enable

# Install deps first so this layer is cached unless manifests change.
# (pnpm-lock.yaml may not exist yet on a fresh clone — the glob tolerates that.)
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install

# App source (bind-mounted in dev for hot reload; copied for standalone runs).
COPY . .

EXPOSE 4000

CMD ["pnpm", "dev"]
