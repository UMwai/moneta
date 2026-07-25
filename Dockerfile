FROM node:22-alpine AS base
RUN corepack enable pnpm

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S moneta && adduser -S moneta -G moneta \
  && mkdir -p /app/data && chown moneta:moneta /app/data
COPY --from=build --chown=moneta:moneta /app/.next/standalone ./
COPY --from=build --chown=moneta:moneta /app/.next/static ./.next/static
COPY --from=build --chown=moneta:moneta /app/public ./public
USER moneta
EXPOSE 3000
VOLUME ["/app/data"]
ENV DATABASE_PATH=/app/data/moneta.db
CMD ["node", "server.js"]
