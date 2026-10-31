# syntax=docker/dockerfile:1
FROM node:22-alpine AS dependencies
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
RUN --mount=type=cache,id=evseye-api-pnpm,target=/pnpm/store \
    pnpm --filter @evs-eye/api install --frozen-lockfile --ignore-scripts --store-dir /pnpm/store
# Package dependencies before copying source, so code/seed edits reuse this layer.
# Keep the Prisma CLI available for the compose migration and seed jobs.
RUN --mount=type=cache,id=evseye-api-pnpm,target=/pnpm/store \
    pnpm --filter @evs-eye/api deploy --legacy --offline --ignore-scripts --store-dir /pnpm/store /app/api-deploy

FROM dependencies AS build
COPY apps/api/prisma/schema.prisma apps/api/prisma/schema.prisma
COPY apps/api/prisma.config.ts apps/api/prisma.config.ts
RUN cd /app/apps/api && DATABASE_URL=postgresql://unused:unused@localhost:5432/unused \
    node_modules/.bin/prisma generate
COPY apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/nest-cli.json apps/api/
COPY apps/api/src apps/api/src
RUN cd apps/api && node_modules/.bin/nest build

FROM dependencies AS runtime-dependencies
COPY apps/api/prisma/schema.prisma /app/api-deploy/prisma/schema.prisma
COPY apps/api/prisma.config.ts /app/api-deploy/prisma.config.ts
# Install migration-engine binaries while building as root, before switching users.
RUN node /app/api-deploy/node_modules/.pnpm/@prisma+engines@*/node_modules/@prisma/engines/scripts/postinstall.js \
    && cd /app/api-deploy && DATABASE_URL=postgresql://unused:unused@localhost:5432/unused \
    node_modules/.bin/prisma generate

FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S evseye && adduser -S evseye -G evseye
COPY --from=runtime-dependencies /app/api-deploy ./apps/api
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY apps/api/scripts ./apps/api/scripts
USER evseye
EXPOSE 3000
CMD ["node", "apps/api/dist/main"]
