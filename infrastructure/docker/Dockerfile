FROM node:22-slim AS builder
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
ARG APP_DIR
RUN pnpm build:packages && pnpm --filter "./apps/${APP_DIR}" build

FROM node:22-slim AS runtime
WORKDIR /app
ARG APP_DIR
ENV APP_DIR=${APP_DIR}
COPY --from=builder /app ./
CMD ["sh", "-c", "node apps/$APP_DIR/dist/main.js"]
