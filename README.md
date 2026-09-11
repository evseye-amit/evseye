# EVs Eye

Multi-tenant EV fleet-management MVP.

## Local development

1. Copy `.env.example` to `.env`.
2. Run `docker compose up --build` for the local stack. Compose runs one-shot migration and idempotent demo-seed jobs before starting the API, with local private MinIO object storage for media testing.
3. For non-Docker development, run `pnpm install`, `pnpm db:generate`, `pnpm db:migrate`, and `pnpm db:seed`.
4. Run `pnpm dev:api` and `pnpm dev:web`.

The API health endpoints are `/health` and `/health/ready`.

The development seed creates tenant slug `demo` and tenant-admin mobile `+919000000000`.

For production, use real SMS and KYC adapters, a private S3 bucket, IAM-based AWS credentials, and non-development token secrets. The API rejects the console SMS provider, sandbox KYC provider, and an unset S3 bucket in production.

Run Prisma migrations once as a deployment job before rolling out API replicas:

```sh
./apps/api/node_modules/.bin/prisma migrate deploy --schema=apps/api/prisma/schema.prisma
```

## Verification

Run `pnpm typecheck`, `pnpm test`, and `pnpm build` before review or release.
For the complete deployment and acceptance procedure, see `docs/release-checklist.md`.
For the local end-to-end manual test flow, see `docs/manual-acceptance.md`.
