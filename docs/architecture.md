# Architecture

EVs Eye is a pnpm workspace for a multi-client EV fleet-management application. The root [README](../README.md) describes the current product surface.

## Components

- `apps/api`: NestJS API using Fastify, Prisma, PostgreSQL, and Redis. Its Prisma schema and migrations live in `apps/api/prisma`.
- `apps/web`: Next.js operations and platform web application.
- `apps/site`: separately built public site.
- `infra/site`: infrastructure and deployment material for the public site.
- `deployment`, `infra`, and `.github/workflows`: deployment configuration and automation.

The web app uses a server-side gateway for client-scoped API calls. `API_INTERNAL_URL` points the Next server at the API and `CLIENT_PROXY_SECRET` is shared by the gateway and API. Client identity and authorization must be resolved on the server; see [client branding and domains](clients/branding-and-domains.md) for the gateway and hostname model.

## Runtime dependencies

The local stack uses PostgreSQL, Redis, and MinIO through Docker Compose. PostgreSQL stores application data; Prisma migrations manage schema changes. Redis supports application runtime features. MinIO provides local private S3-compatible media storage. Production uses private S3 and provider integrations configured through environment variables.

The API serves `/health`, `/health/ready`, and, when enabled, Swagger UI at `/api/docs`. The OpenAPI JSON is at `/api/docs-json`. See the [API README](../apps/api/README.md) for API conventions and the [configuration guide](configuration.md) for runtime settings.

## Data and security boundaries

The application is multi-client. Queries and mutations involving client-owned data must enforce client isolation at the API layer. Browser-supplied client identifiers are not an authorization source. API credentials, provider secrets, and the internal gateway secret belong on the server. The public site is built and deployed separately from the API and operations web app.
