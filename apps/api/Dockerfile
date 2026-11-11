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
# Trust AWS RDS certificates without disabling TLS verification. Keep this
# digest pinned so a changed remote bundle fails the image build visibly.
ARG RDS_CA_BUNDLE_SHA256=90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b
RUN apk add --no-cache ca-certificates \
    && mkdir -p /usr/local/share/rds \
    && wget -qO /usr/local/share/rds/rds-global-bundle.pem \
      https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
    && echo "${RDS_CA_BUNDLE_SHA256}  /usr/local/share/rds/rds-global-bundle.pem" \
      | sha256sum -c - \
    && awk 'BEGIN { certificate = 0 } /-----BEGIN CERTIFICATE-----/ { certificate++ } certificate { print > ("/usr/local/share/ca-certificates/rds-" certificate ".crt") }' \
      /usr/local/share/rds/rds-global-bundle.pem \
    && update-ca-certificates
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/rds/rds-global-bundle.pem
RUN addgroup -S evseye && adduser -S evseye -G evseye
COPY --from=runtime-dependencies /app/api-deploy ./apps/api
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY apps/api/scripts ./apps/api/scripts
USER evseye
EXPOSE 3000
CMD ["node", "apps/api/dist/main"]
