# EVs Eye

Multi-tenant EV fleet-management MVP.

## Local development

1. Copy `.env.example` to `.env`.
2. Run `docker compose up --build` for the local stack, or run PostgreSQL and Redis separately.
3. Run `pnpm install`, `pnpm db:generate`, `pnpm db:migrate`, and `pnpm db:seed`.
4. Run `pnpm dev:api` and `pnpm dev:web`.

The API health endpoints are `/health` and `/health/ready`.

The development seed creates tenant slug `demo` and tenant-admin mobile `+919000000000`.

## Verification

Run `pnpm typecheck`, `pnpm test`, and `pnpm build` before review or release.
For the complete deployment and acceptance procedure, see `docs/release-checklist.md`.
