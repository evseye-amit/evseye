# Test layout

- `apps/api/test/`: API unit and integration tests, grouped to mirror `apps/api/src/`. The existing end-to-end suite and its setup also live here.
- `apps/web/test/`: web tests, grouped to mirror `apps/web/src/`.
- `test/`: repository gateway tests and the local client-access regression script.

Run `pnpm test` for API, web, and gateway tests, or use the individual commands:

- `pnpm --filter @evs-eye/api test`
- `pnpm test:e2e`
- `pnpm test:web`
- `pnpm test:gateway`
- `pnpm test:client-access`

API integration suites retain their existing opt-in database environment variables. The client-access script requires the local application and demo seed data; it is not included in `pnpm test`.
