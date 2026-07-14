# ---- Build stage ----
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Containers serve from the domain root; GitHub Pages builds keep the
# /Meeting_KMS_Original/ base from vite.config.ts instead.
ENV VITE_BASE_PATH=/
RUN npm run build

# ---- Serve stage ----
FROM nginx:stable-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
# The official nginx image runs every script in /docker-entrypoint.d/
# before starting; 40-runtime-env.sh writes env.js from container env vars.
COPY docker/40-runtime-env.sh /docker-entrypoint.d/40-runtime-env.sh
RUN chmod +x /docker-entrypoint.d/40-runtime-env.sh

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
