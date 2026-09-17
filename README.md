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

### Client welcome email (MSG91)

After successful Super Admin client onboarding (not draft saves), the Account Admin receives the welcome email. Use `docs/email/client-welcome.html` as the MSG91 HTML template, with subject **Welcome to EVs Eye — Your account is ready**. Register the five variables exactly as written: `client_name`, `company_name`, `company_code`, `registered_mobile_number`, and `login_url`. The greeting uses the Account Admin's name.

Configure `EMAIL_PROVIDER=msg91`, `MSG91_AUTH_KEY` in your secret manager, `MSG91_EMAIL_DOMAIN`, `MSG91_EMAIL_FROM`, `MSG91_WELCOME_TEMPLATE_ID`, and `CLIENT_LOGIN_URL` (the public HTTPS Client Operations login URL in production). MSG91 requires a verified sending domain and sender and a published template. Development defaults to `EMAIL_PROVIDER=disabled` to avoid sending to real clients; the HTML file can be opened locally to review layout. No SMTP server is required.

Email is attempted after the client transaction commits. The API returns `welcomeEmail` status, the onboarding confirmation displays it, and `CLIENT_WELCOME_EMAIL` audit entries record the result. Provider acceptance is not proof of inbox delivery; use MSG91 logs for delivery/bounce status. Failures do not roll back or duplicate the client. Automatic retries are not enabled; check MSG91 logs before manually sending a failed welcome email to avoid duplicates following a timeout.
