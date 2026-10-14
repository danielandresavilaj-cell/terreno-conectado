# Imagen del backend NestJS (monolito modular).
#
# El contexto de build es la RAÍZ del monorepo (no `backend/`): `@terreno/shared`
# es un workspace npm y se resuelve por el symlink que crea `npm ci`.
#
#   docker build -f backend/Dockerfile -t terreno-backend .
#   docker build -f backend/Dockerfile --target build -t terreno-backend-tools .   # migraciones/seed
#
# Tres stages: `build` (compila shared+backend), `runtime` (API en producción) y
# el propio `build` reutilizado como imagen de herramientas (`--target build`)
# para corridas puntuales de `db:migrate` / `db:seed` (necesitan devDeps).

# ---- build ---------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /repo

# Manifiestos primero: cachea la capa de `npm ci` si no cambian las deps.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY infra/package.json ./infra/
RUN npm ci

COPY tsconfig.base.json ./
COPY shared ./shared
COPY backend ./backend
RUN npm run build --workspace @terreno/shared \
 && npm run build --workspace @terreno/backend

# ---- runtime -------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo

COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY infra/package.json ./infra/
RUN npm ci --omit=dev

# Artefactos compilados + migraciones (por si se corren one-shots desde aquí).
COPY --from=build /repo/shared/dist ./shared/dist
COPY --from=build /repo/backend/dist ./backend/dist
COPY backend/db ./backend/db

# Volumen de adjuntos (`SYNC_VOLUME`): se crea con el dueño correcto para que
# un named volume herede la propiedad (el proceso corre como `node`).
RUN mkdir -p /data/sync && chown -R node:node /data/sync

USER node
EXPOSE 3000
WORKDIR /repo/backend
CMD ["node", "dist/main.js"]
