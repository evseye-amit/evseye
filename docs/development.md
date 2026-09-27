# Development

## Start locally

1. Install the pnpm version declared in `package.json` and copy `.env.example` to `.env`.
2. Run `pnpm install`.
3. Start the full local stack with `docker compose up --build`.

For development outside Docker, provide PostgreSQL and Redis using the URLs in `.env`, then run `pnpm db:generate`, `pnpm db:migrate`, and `pnpm db:seed`. Start the apps with `pnpm dev:api` and `pnpm dev:web`. The API defaults to port 3000 and the web app to port 3001.

## Verify changes

- `pnpm lint`: workspace lint scripts.
- `pnpm typecheck`: workspace type checks.
- `pnpm test`: API unit tests and gateway security tests.
- `pnpm test:e2e`: API end-to-end tests; requires its configured services.
- `pnpm build`: workspace production builds.
- `pnpm verify`: typecheck, unit and gateway tests, then build.

Run the checks relevant to a change before review. See the [release checklist](release-checklist.md) and [manual acceptance guide](manual-acceptance.md) for release and local acceptance workflows.

## Database changes

Edit `apps/api/prisma/schema.prisma`, create and test a Prisma migration with `pnpm db:migrate`, and regenerate the client with `pnpm db:generate`. Deployment runs migrations as a separate job before API replicas roll out; see [deployment](deployment.md).
