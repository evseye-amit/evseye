# Deployment

Use the existing workflow and infrastructure files as the deployment source of truth: `.github/workflows/deploy-staging.yml`, `.github/workflows/deploy-site.yml`, `infra`, and `deployment`. The public site's deployment is described in [its infrastructure README](../infra/site/README.md).

## Application rollout

1. Configure production environment variables and secrets using [configuration](configuration.md) and [AWS setup](aws-setup.md).
2. Run `pnpm verify` and the checks in the [release checklist](release-checklist.md).
3. Build the API and web images using their Dockerfiles.
4. Run Prisma migrations once as a deployment job before starting or rolling out API replicas:

   ```sh
   ./apps/api/node_modules/.bin/prisma migrate deploy --schema=apps/api/prisma/schema.prisma
   ```

5. Roll out the API and web app, then check `/health`, `/health/ready`, login, client isolation, and the acceptance flows.

Do not run development seed data or `prisma migrate dev` in production. See [client branding and domains](clients/branding-and-domains.md) for hostname, gateway, TLS, and domain verification requirements.
