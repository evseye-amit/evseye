# EVs Eye release checklist

## Before deployment

- Set production secrets in the deployment secret store; never use `.env.example` values.
- Run `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.
- Run reviewed Prisma migrations once against the target database using the API image as a one-shot deployment job: `./apps/api/node_modules/.bin/prisma migrate deploy`. Do not run migrations in every API replica.
- Verify S3 bucket privacy, encryption, lifecycle rules, and IAM least privilege.
- Verify SMS and KYC provider credentials using sandbox accounts first.

## Acceptance flow

1. Seed or create a tenant admin and authenticate by OTP.
2. Create rider, KYC records, fleet, hub, and fleet components.
3. Upload rider and fleet photos through signed URLs.
4. Allocate an available fleet and complete pre-allocation inspection.
5. Start deallocation, verify rider and operator OTPs, complete post-inspection, and release fleet.
6. Register IoT device and send location, heartbeat, start, and stop packets.
7. Confirm dashboard and fleet current-state results are tenant-isolated.

## Incident basics

- SMS/KYC outage: retain workflow state, retry through provider adapter, do not bypass verification.
- Object-storage outage: leave media `PENDING_UPLOAD`; retry signed upload.
- IoT delay: evaluate online/offline only from configured heartbeat threshold.
- Database incident: restore from encrypted backup and rerun migration status validation.
