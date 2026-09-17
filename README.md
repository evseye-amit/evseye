# EVs Eye

Multi-client EV fleet-management MVP with strict client isolation.

## Local development

1. Copy `.env.example` to `.env`.
2. Run `docker compose up --build` for the local stack. Compose runs one-shot migration and idempotent demo-seed jobs before starting the API, with local private MinIO object storage for media testing.
3. For non-Docker development, run `pnpm install`, `pnpm db:generate`, `pnpm db:migrate`, and `pnpm db:seed`.
4. Run `pnpm dev:api` and `pnpm dev:web`.

The API health endpoints are `/health` and `/health/ready`.

The development seed creates client slug `demo` and client-admin mobile `+919000000000`.

## Super Admin (development)

Open `http://localhost:3001/platform` to access the platform workspace. The
development seed creates the platform-owned Super Admin account
`+919100000000`; in development, its OTP is `123456`.

From this workspace, a Super Admin can onboard a client, create versioned
rider-onboarding configurations from the immutable master-step catalog, edit a
draft, and activate it. Activating a version archives the client's previous
active configuration. Client-side master-data and workflow change requests are
intentionally not exposed yet; they will be built as an approval workflow in
the next Super Admin slice.

For production, use real SMS and KYC adapters, a private S3 bucket, IAM-based AWS credentials, and non-development token secrets. The API rejects the console SMS provider, sandbox KYC provider, and an unset S3 bucket in production.

Client logos use presigned upload (PUT) and download (GET) URLs. Local Docker Compose uses MinIO: the API accesses `http://minio:9000` and browser URLs use `http://localhost:9000`. In production, set `S3_BUCKET` and `AWS_REGION` for the private AWS S3 bucket, provide IAM permissions, and leave `S3_ENDPOINT` and `S3_PUBLIC_ENDPOINT` unset. Allow the deployed web origin in the bucket CORS configuration for browser PUT/GET requests with the `Content-Type` header. Client logos do not require public bucket access or `MEDIA_PUBLIC_BASE_URL`; URL validity is controlled by `S3_SIGNED_URL_TTL_SECONDS`.

Run Prisma migrations once as a deployment job before rolling out API replicas:

```sh
./apps/api/node_modules/.bin/prisma migrate deploy --schema=apps/api/prisma/schema.prisma
```

## Verification

Run `pnpm typecheck`, `pnpm test`, and `pnpm build` before review or release.
For the complete deployment and acceptance procedure, see `docs/release-checklist.md`.
For the local end-to-end manual test flow, see `docs/manual-acceptance.md`.
