# syntax=docker/dockerfile:1
FROM node:22-alpine AS dependencies
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=evseye-web-pnpm,target=/pnpm/store \
    pnpm --filter @evs-eye/web install --frozen-lockfile --ignore-scripts --store-dir /pnpm/store

FROM dependencies AS build
COPY apps/web apps/web
RUN --mount=type=cache,id=evseye-web-next,target=/app/apps/web/.next/cache \
    cd apps/web && node_modules/.bin/next build --webpack

FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
RUN addgroup -S evseye && adduser -S evseye -G evseye
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chmod=755 /app/apps/web/public ./apps/web/public
USER evseye
EXPOSE 3001
CMD ["node", "apps/web/server.js"]
