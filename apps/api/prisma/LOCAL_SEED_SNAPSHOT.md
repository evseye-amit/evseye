# Local master and demo seed snapshot

`local-master-demo-seed.sql` captures the reusable rows in the local PostgreSQL
database across 48 populated tables. It supplements the application seed scripts
with a point-in-time copy of the local catalog and demo tenant. Generate it with:

```sh
bash scripts/export-local-master-demo-seed.sh
```

Restore it **only into a freshly migrated, empty local database** as the local
PostgreSQL superuser. The file checks for existing client, feature, or OEM rows,
uses a transaction, and temporarily disables foreign-key triggers to load circular
references. For example, after applying Prisma migrations to a new database:

```sh
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U evseye \
  -d YOUR_NEW_LOCAL_DATABASE < apps/api/prisma/local-master-demo-seed.sql
```

Do not run the snapshot after `seed.mjs` or against an active database. It replaces
rows in its included tables and uses the source database's IDs. The normal
`pnpm db:seed` path remains the idempotent development seed for the active stack.

The export excludes login sessions, OTPs, audit logs, KYC results and credentials,
payments, usage history, uploaded media, and other operational records. Tables
without reusable rows remain empty. Local database fields absent from `main`'s
checked-in schema (`ClientPreLoginConfig` and `Client.requestedLocales`) are
omitted so the snapshot restores against `main` migrations. Catalog
`translations` are included.
