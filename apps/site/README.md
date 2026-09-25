# EVsEye marketing site

This is the supplied static HTML site, with the unpublished blog removed. It is deliberately separate from `apps/web`, which serves the client and Super Admin applications.

Run `pnpm --filter @evs-eye/site build` to validate local asset references and create `dist/`. The deployment workflow uploads only `dist/` to the private marketing S3 bucket and invalidates its CloudFront distribution. No server process or browser API credentials are required.

Public URL: `https://www.evseye.com/`. The apex domain redirects there. Hosting configuration and bootstrap instructions are in `infra/site/README.md`.
