# Configuration

`.env.example` is the source of truth for local environment variable names and defaults. Copy it to `.env` for local development. Keep credentials and production secrets in the deployment secret manager; do not commit `.env`.

## Core services

- `NODE_ENV`, `API_PORT`, and `SWAGGER_ENABLED` control the API environment, port, and API documentation.
- `DATABASE_URL` points Prisma to PostgreSQL; `REDIS_URL` points the API to Redis.
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and `OTP_HASH_SECRET` must be distinct secrets. The related TTL and attempt variables tune authentication behavior.
- `API_RATE_LIMIT` and `API_RATE_TTL_MS` configure request rate limiting.

## Web gateway and domains

`API_INTERNAL_URL` and `CLIENT_PROXY_SECRET` configure the server-side Next-to-API gateway. `APP_BASE_DOMAINS` and `APP_GENERIC_HOSTS` define client and generic hosts. `SESSION_COOKIE_SECURE=false` is for local HTTP only. `NEXT_PUBLIC_API_URL` is a public browser setting; do not place secrets in `NEXT_PUBLIC_` variables. See [client branding and domains](clients/branding-and-domains.md).

## Integrations

- Storage: `S3_BUCKET`, optional local S3 endpoints, `AWS_REGION`, optional credentials, signed URL TTL, and `MEDIA_PUBLIC_BASE_URL` for media delivery. See [AWS setup](aws-setup.md).
- SMS and KYC: `SMS_PROVIDER`, provider-specific SMS settings, `KYC_PROVIDER`, and KYC API settings. See [SMS providers](sms-providers.md).
- Email: `EMAIL_PROVIDER`, MSG91 settings, and `CLIENT_LOGIN_URL`. See [email providers](email/providers.md).
- Payments: `PAYMENT_PROVIDER` and Cashfree credentials, environment, webhook, and return URLs. See the [Cashfree guide](../apps/api/docs/cashfree-phase2a.md).

Review `.env.example` and the integration guide for each provider before enabling it. The local defaults intentionally disable live email and payments.
