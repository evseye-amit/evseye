# Client branding and domains

## Existing architecture and compatibility

EvsEye uses `Client` as its organization boundary; `Client.id` is the authorization identifier. `Client.slug` and `companyCode` are already unique. The existing direct `User.clientId` and single `User.role` are preserved. Globally normalized mobile uniqueness remains unchanged. New clients must use a DNS-safe, non-reserved slug; existing slugs are not silently rewritten. Company codes on the onboarding form currently also initialize the slug. Editing business details does not rename it.

NestJS/Fastify services use Prisma and explicit `clientId` predicates, `ClientContextService`, `AccessTokenGuard`, and `RolesGuard`. Responses keep `{ data }`; errors keep `{ error, requestId }`. No second ORM, storage SDK, authentication framework or frontend library was introduced. Feature/package tables (`ClientFeature`, `PackageFeature`, subscriptions) and business/operations/billing profiles already provide feature and settings separation; these are reused rather than duplicated into new settings tables.

The frontend uses React state and fetch wrappers rather than all of the libraries mentioned in the proposed stack. No middleware previously resolved clients. Next's asynchronous `headers()` now resolves the host in the root server layout. The same pages/components/build serve all clients. Browser API requests use `/api/v1/*`; a Next route handler sends them to the existing API with a server-only gateway secret and the incoming Host. The API independently checks current user/client membership and matches the requested host. The domain is never proof of membership.

`www` and the base domain resolve generic context if routed here; route the marketing site separately at the edge. `app`, `api`, `admin`, `platform`, `mail`, `smtp`, `cdn`, `media`, `assets`, `static`, `support`, and `status` cannot become client subdomains. Unknown or unverified addresses show Workspace unavailable instead of another client's branding.

## Database rollout

1. Back up PostgreSQL and review migration `20260918100000_client_branding_domains`.
2. Run `prisma migrate deploy` through the existing migration deployment job, then deploy API and web together.
3. The additive migration creates `ClientDomain`, `ClientDomainType`, and `ClientBranding`. It preserves Client/User IDs and copies existing business-profile logo keys into branding. Domain hostname and per-client branding uniqueness are enforced; a partial unique index allows at most one primary domain per client.
4. No production hostnames are guessed in SQL. Existing valid client slugs resolve under configured base domains automatically; explicit domain mappings take precedence. Reserved/invalid legacy slugs keep generic company-code login; review them before an explicit planned rename.
5. Logo/favicons remain object keys, not persisted expiring URLs. Reads generate signed URLs using the existing private S3/MinIO storage provider. Old logos remain as fallback. Existing Super Admin logo updates synchronize the branding record.

## Local development

Use Docker Compose's shared development gateway secret and `APP_BASE_DOMAINS=localhost`. Generic login remains `http://localhost:3001/`. To run Next outside Docker, put `API_INTERNAL_URL` and `CLIENT_PROXY_SECRET` in the Next server environment (for example `apps/web/.env.local`) as well as the API environment; the secrets must match. Never use a `NEXT_PUBLIC_` variable for the gateway secret. Browser `NEXT_PUBLIC_API_URL` is superseded by the same-origin gateway.

After migration, create the opt-in demo clients:

```sh
docker compose exec -T api node apps/api/prisma/seed-client-branding.mjs
```

The script refuses production and does not overwrite existing client branding. It creates:

- ACME Mobility: `http://acme.localhost:3001/`, admin mobile `9100000101`.
- Blue Mobility: `http://bluemobility.localhost:3001/`, admin mobile `9100000102`.

Both use the existing development OTP adapter. If your browser does not resolve `*.localhost`, add explicit development hosts entries pointing these two names to `127.0.0.1`. No per-client build is needed. Generic login still takes company code plus mobile; branded login takes mobile and resolves the company server-side.

## Branding and domain administration

Client Admins can open **Branding settings** in Client Operations to upload logo/favicon and change colors, login title/subtitle and support contacts. Image formats are PNG/JPEG/WebP, maximum 2 MB. Upload completion checks stored size, MIME type and image signature before attaching a logo or favicon. SVG/HTML are not accepted. Text is rendered as text; colors are limited to six-digit hex values. Arbitrary asset URLs and object keys from another client are not accepted.

Authenticated endpoints, all relative to `/api/v1`:

- `GET /client/identity/context`: public appearance for the authenticated client.
- `PATCH /client/identity/branding`: Client Admin only; no client ID accepted.
- `POST /client/identity/branding/upload-intents` and `/upload-complete`: existing presigned storage workflow.
- `GET /public/client-context`: only public fields resolved by host; never exposes internal IDs, users or private configuration.
- Legacy `/client-branding/public?companyCode=...` now returns null. This prevents unauthenticated company-code discovery; generic login receives branding after authentication.

Super Admins can open **Client → Domains** for active clients to add addresses, inspect verification instructions, verify DNS, change the primary address and remove mappings. Domain mutations are recorded transactionally in the audit log, without logging verification tokens. DNS queries have bounded timeouts.

Super Admin domain API: `/platform/clients/:clientId/domains` supports list/create/delete and `POST /:domainId/verify`, `POST /:domainId/primary`. Own platform subdomains must match the client's slug. Custom domains begin unverified. Publish TXT `_evseye-verification.<hostname>` with value `evseye-verification=<verificationToken>` returned to the Super Admin, then call verify. TLS/routing configuration is a separate deployment requirement. Primary changes are transactional and constrained by the database. Deleting an explicit own-subdomain record does not remove the implicit slug address; disable the Client to revoke all access. Deleting a custom mapping makes that hostname unavailable immediately.

## Security and isolation review

Access JWT validation now loads the current active user using both token user ID and client ID, derives the role from the database and verifies current client status. A disabled/deleted user, inactive/suspended Client or mismatched host is rejected. OTP verification and refresh bind to the resolved client before issuing tokens. Host selection cannot change the client ID in the identity used by services. A Super Admin must use the generic platform host rather than borrowing a client domain.

The reviewed operational services include Fleet, Rider, Hub, Battery/Controller, Allocation/Deallocation, Inspection, KYC, media/photos, Client users, onboarding/import history, dashboard and audit. Entry reads and foreign-reference validation use `clientId`, or an already verified parent. ID-based updates that follow ownership checks retain that verified-parent pattern. Fleet registration/insurance/fitness, component installation histories and onboarding steps inherit ownership from their checked parent. Catalogs (OEM, vehicle types/categories, packages/features) are platform-owned. Super Admin platform controllers are deliberately global and role-guarded. IoT ingestion uses its separate device credential and derives `clientId` from the authenticated device. There is no generic Prisma middleware or frontend filtering used as an authorization boundary.

The new tests cover known/unknown/reserved hosts, ports and malformed hosts, immediate disablement, verified custom domains, header spoofing, cross-domain JWTs, refreshed database roles, own-client branding updates, safe public fields, cross-client object keys and bound OTP verification. Existing operational IDOR and controller guard tests remain part of the API suite. This is an application-level isolation review; it does not add PostgreSQL RLS or claim to prove all possible future queries safe.

Login challenges return an opaque accepted response for unknown accounts and cooldown requests to avoid an explicit membership oracle. Rate limiting still applies. SMS delivery timing can differ; production should apply edge rate limits and abuse monitoring. No list of a mobile number's memberships is exposed.

## Sessions, CORS and caching

Browser access and refresh tokens now live in HttpOnly, SameSite=Strict, host-only session cookies. HTTPS uses `__Host-` cookie names, Secure and Path=/ with no Domain attribute. `SESSION_COOKIE_SECURE` defaults to true; the local HTTP Compose setup explicitly sets it false. Browser JavaScript receives only `{ authenticated: true }` and stores non-secret UI markers; old browser token keys are no longer read and are cleared on fresh login. Never add a parent-domain cookie.

The gateway derives Authorization solely from its cookies and ignores browser Authorization headers. Native API clients can continue to use server-issued bearer tokens directly. Mutating browser requests require an exact Origin (scheme, hostname and port); cross-site Fetch Metadata is also rejected. JSON bodies are bounded to 1 MiB before forwarding. The frontend shares refresh operations and uses browser locks where available to coordinate tabs. Access tokens carry a session ID checked against the database, so logout and refresh rotation revoke the old session immediately. Rotation consumes each refresh session only once. Existing sessions need a fresh login at rollout. The `session-fetch` wrapper handles credential-free browser API calls across both panels. XSS can still perform actions in an open page even though it cannot read HttpOnly tokens; keep normal XSS defenses.

Direct API CORS uses explicit generic origins and verified active client hosts, without credentialed wildcard origins. In production HTTPS is required. Presigned object uploads also need appropriate bucket CORS allowing approved web origins and PUT/GET with Content-Type. Keep the bucket private.

Redis exists in Compose but no reusable application cache abstraction is installed. Resolution intentionally performs fresh database lookups; no stale positive or negative cache survives disablement, domain edits or branding changes. `ClientResolverService` is the single replacement boundary for a future distributed cache with explicit invalidation. Public context responses and proxy responses use `no-store`; no cross-client HTML/API caching is allowed. Signed branding URLs renew while the page is open.

## Production configuration and AWS

Set `APP_BASE_DOMAINS=evseye.com`, explicit `APP_GENERIC_HOSTS` for the generic application/API addresses, the internal `API_INTERNAL_URL`, and the same random `CLIENT_PROXY_SECRET` in API and Next secret stores. Restrict direct backend ingress to trusted services where possible. Never expose or log the gateway secret. The local Compose file is development infrastructure and must not be used unchanged for production.

Use wildcard DNS and TLS for `*.evseye.com`, pointing client hosts and `app` to the same Next service; route `www` to marketing and `api` to the same Nest API. CloudFront alternate names must be covered by the certificate SANs ([AWS wildcard domain documentation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/alternate-domain-names-wildcard.html)). Preserve viewer Host through the frontend origin request policy; CloudFront otherwise substitutes its origin host ([AWS custom-origin behavior](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/RequestAndResponseBehaviorCustomOrigin.html)). Enable ALB host preservation and do not rewrite client hosts ([AWS ALB attributes](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-load-balancer-attributes.html)).

Disable CDN caching for HTML, RSC and `/api/v1/*` so neither authenticated data nor branding can cross hosts. Static versioned Next assets can share a cache. Provision separate certificates/alternate domain entries for custom customer domains and complete DNS ownership verification before routing them. No AWS infrastructure is provisioned by this change.

Because API requests now traverse the Next gateway, configure per-IP abuse controls at the public edge; the existing in-process API throttle observes gateway connections and is not a distributed per-user quota. Restrict trusted forwarded headers at the edge before enabling any forwarded-IP trust. Use production SMS/KYC adapters; the existing repository only implements the console SMS adapter, which remains a separate go-live prerequisite.

## Future multiple-client membership

Do not remove global mobile uniqueness until product policy changes. A future `ClientMembership` rollout should backfill one membership per current User, validate parity, add an authenticated membership selector, issue client-scoped sessions, then migrate services gradually. Switching clients must mint a new session from a verified membership, never mutate client IDs from frontend state. This change deliberately retains the current one-mobile/one-role behavior.

## Verification record

Local verification for this change:

- Prisma schema validation and generation passed; the additive migration applied successfully to the development database.
- Workspace TypeScript checks passed.
- Workspace lint passed with no errors; existing warnings remain.
- API unit suite after hardening: 30 files, 122 tests passed. Gateway security suite: 3 tests passed.
- Existing HTTP end-to-end suite: 8 tests passed, including full Nest application startup, validation, CORS and throttling.
- Final API and web Docker builds passed and the local services were restarted with those images.
- Browser verification passed for both branded login pages, generic company-code login, ACME OTP login/dashboard, branding-settings save and sign-out. The platform attribution remains visible.
- Live demo-client checks passed for generic/public context, distinct branding, unknown hosts, host-bound OTP verification, cross-client access-token rejection and rejection of injected client IDs in branding updates.
- Temporary Blue Mobility Fleet and Rider records returned 404 to the ACME account on ACME's host, and 403 on Blue Mobility's host. The temporary records were removed after the checks.
- The same live isolation checks passed through the final Next same-origin gateway.

Run the repository checks with `pnpm typecheck`, `pnpm lint`, and `pnpm test`. With the local database running, run the HTTP suite from `apps/api` using `node --env-file=../../.env node_modules/vitest/vitest.mjs run --config vitest.config.e2e.ts`. Build the shared applications with `docker compose build api web`.

### Intentionally deferred

Production DNS/certificates, AWS routing, bucket CORS and secrets must be configured in deployment. Custom-domain APIs and the Super Admin Domains dialog are implemented; public certificate provisioning remains a deployment responsibility. Distributed resolver caching and multiple-client memberships remain future work. Existing production SMS/KYC adapter gaps are separate go-live prerequisites. No per-client deployments are needed.

## Production-hardening local workflow

### Normal local HTTP

```sh
docker compose up -d --build
# Only if demo clients have not yet been created:
docker compose exec -T api node apps/api/prisma/seed-client-branding.mjs
pnpm test:client-access
```

The test requires the local `.env` database connection, seeded master data and development OTP adapter. It creates and removes only its own temporary Fleet/Rider fixtures, temporarily uploads a tiny demo favicon, restores the previous favicon and removes the uploaded object. It checks branding, CSRF, request limits, cookies, presigned MinIO uploads, cross-client access, refresh rotation and logout. Wait 60 seconds between runs to respect OTP cooldown. Real client data is not modified. Old sessions need a fresh sign-in.

### Local HTTPS and Secure cookies

```sh
sh scripts/create-local-client-tls.sh
docker compose -f docker-compose.yml -f docker-compose.client-tls.yml up -d --no-deps api web client-edge
CLIENT_TEST_URL=https://localhost:8443 pnpm test:client-access
```

Addresses: `https://app.localhost:8443`, `https://acme.localhost:8443`, and `https://bluemobility.localhost:8443`. MinIO uses `https://localhost:9443` so uploads and signed images do not mix HTTP with HTTPS. Generated private keys are ignored by Git. The smoke test trusts only the generated certificate via its explicit CA option; TLS verification stays enabled. Browser testing requires you to install/trust this local development certificate yourself or supply a certificate you already trust. The script does not alter system trust or bypass browser certificate warnings.

HTTP and HTTPS modes are intentionally separate. Restore normal local mode with:

```sh
docker compose -f docker-compose.yml -f docker-compose.client-tls.yml stop client-edge
docker compose up -d --no-deps api web
```

The local edge preserves Host and applies per-IP request limits using [NGINX proxy header configuration](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) and [request limiting](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html). This is a local verification fixture, not an AWS deployment. For production, apply equivalent limits at WAF/your public ingress, use managed publicly trusted TLS, restrict direct API/web origins and configure private S3 CORS. Pin deployment images to approved digests. Do not deploy the local MinIO server or its credentials.

Use `deployment/client-access/production.env.example` as the production configuration checklist. It deliberately contains no real secrets or invented SMS/KYC implementations. Production DNS, TLS, IAM, SMS/KYC adapters and delivery-provider credentials still require deployment-specific completion. The client-access hardening does not establish readiness of every unrelated subsystem.

### Hardening verification results

Both `pnpm test:client-access` on HTTP and `CLIENT_TEST_URL=https://localhost:8443 pnpm test:client-access` passed locally, including a real presigned MinIO upload, Secure/HttpOnly cookie flags in HTTPS mode, CSRF rejection, request-size enforcement, cross-client Fleet/Rider access denial, refresh rotation and logout revocation. TLS certificate verification remained enabled. Temporary data and image objects were cleaned up, and normal HTTP Compose configuration was restored after testing.

Super Admin browser verification covered OTP login, Client → Domains, the verified primary domain display and sign-out. Production DNS/certificates and real-provider delivery are not covered by these local checks.
