# Imagen del frontend (PWA ya construida) servida por nginx.
#
# Contexto de build: la RAÍZ del monorepo.
#   docker build -f infra/frontend.Dockerfile \
#     --build-arg VITE_API_URL=/api/v1 \
#     --build-arg VITE_DEMO_PASSWORD=... \
#     -t terreno-conectado-frontend .
#
# Vite incrusta VITE_API_URL y VITE_DEMO_PASSWORD en tiempo de BUILD: por eso son
# `--build-arg`, no variables de entorno del contenedor.

FROM node:22-bookworm-slim AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY infra/package.json ./infra/
RUN npm ci

COPY tsconfig.base.json ./
COPY shared ./shared
COPY frontend ./frontend

# En despliegue same-origin (Caddy sirve `/` y `/api/*`) la API es relativa.
ARG VITE_API_URL=/api/v1
ARG VITE_DEMO_PASSWORD
ARG VITE_PUBLIC_DEMO=false
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_DEMO_PASSWORD=$VITE_DEMO_PASSWORD
ENV VITE_PUBLIC_DEMO=$VITE_PUBLIC_DEMO

RUN npm run build --workspace @terreno/shared \
 && npm run build --workspace @terreno/frontend

FROM nginx:1.27-alpine AS runtime
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/frontend/dist /usr/share/nginx/html
EXPOSE 80
