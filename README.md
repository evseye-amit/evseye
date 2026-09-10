# EVs Eye

Multi-tenant EV fleet-management MVP.

## Local development

1. Copy `.env.example` to `.env`.
2. Run `docker compose up --build` for the local stack, or run PostgreSQL and Redis separately.
3. Run `pnpm install`, `pnpm db:generate`, and `pnpm db:migrate`.
4. Run `pnpm dev:api` and `pnpm dev:web`.

The API health endpoints are `/health` and `/health/ready`.
