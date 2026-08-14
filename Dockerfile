# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────── build stage
# Instala TODAS as deps (inclui dev do client p/ o vite build) e compila o dist.
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Toolchain nativo p/ o better-sqlite3 (fallback caso não haja prebuild p/ o ABI).
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copia só os manifestos primeiro → camada de deps cacheável entre builds.
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci

# Código + build do client (vite → client/dist).
COPY . .
RUN npm run build

# Enxuga p/ deps de produção (dropa vite/plugin-react/concurrently, mantém o
# binário nativo já compilado do better-sqlite3).
RUN npm prune --omit=dev

# ───────────────────────────────────────────────────────────── runtime stage
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    DB_PATH=/data/rashid.db

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/client/dist  ./client/dist
COPY --from=build /app/server       ./server
COPY --from=build /app/scripts      ./scripts
COPY --from=build /app/package.json ./package.json

EXPOSE 3001
CMD ["node", "server/index.js"]
