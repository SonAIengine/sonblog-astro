# Base stage for building the static files
FROM node:22.12.0-bookworm-slim AS base
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.29.1 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# Runtime stage for serving the application
FROM nginx:mainline-alpine-slim AS runtime
COPY --from=base /app/dist /usr/share/nginx/html
EXPOSE 80
