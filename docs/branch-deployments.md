# Branch-driven deployments

| Branch | CI | API and web | Marketing site |
| --- | --- | --- | --- |
| `dev` | Every push and pull request | Staging ECS, `ap-south-1` | Not deployed yet |
| `main` | Every push and pull request | Production ECS, `ap-south-2`, after manual staging-image promotion | `https://www.evseye.com/` when enabled |

Staging runs after a successful **push** CI run. It checks that the commit is still the tip of `dev`, deploys API and web images by digest, and publishes a small provenance artifact containing the source SHA and image digests. Production is manual: it accepts the staging SHA and successful staging workflow-run ID, requires the same source tree as `main`, copies the two digests to production ECR without rebuilding, runs migration, then updates ECS. A pull request CI run does not deploy. Marketing site publication remains a separate CI-triggered workflow.
The staging marketing site is intentionally deferred to avoid additional AWS costs. The `infra/site-staging` Terraform root remains available for a later opt-in rollout, but it must not be initialized or applied now.

## GitHub environments

Create GitHub Actions environments named `staging` and `production`. They are used by the API/web and site jobs. Set the repository variable `PRODUCTION_DEPLOY_ENABLED=false` until production infrastructure and secrets are ready. Set it to `true` only after the production cutover checklist is complete. Set the following **environment secrets** independently in each environment:

| Secret | Source |
| --- | --- |
| `AWS_ROLE_ARN` | Application Terraform `github_actions_role_arn` output for that environment. |
| `SITE_AWS_ROLE_ARN` | `infra/site` `github_actions_role_arn` output for the production site. No staging site role is needed while staging site deployment is deferred. |
| `ECR_API_REPO`, `ECR_WEB_REPO`, `ECR_API_URL` | That environment's ECR repositories and full API repository URL. |
| `ECS_CLUSTER`, `ECS_API_SERVICE`, `ECS_WEB_SERVICE` | That environment's ECS cluster and service names. |
| `ECS_API_TASK`, `ECS_WEB_TASK`, `ECS_MIGRATE_TASK`, `ECS_TASK_SG` | That environment's ECS task definition families and task security group. |
| `WEB_URL`, `API_URL` | That environment's hostnames, without `https://`. |
| `STAGING_AWS_ACCOUNT_ID` (variable) | AWS account containing the staging ECR repositories. Required by the production promotion workflow. |

Set these **production environment variables** from the production site Terraform outputs:

- `SITE_BUCKET` = `site_bucket`
- `SITE_DISTRIBUTION_ID` = `cloudfront_distribution_id`

Remove or migrate same-named repository-level secrets and variables. Environment values take precedence, but retaining shared deployment values makes misconfiguration harder to spot. Production's environment deployment branch rule should be `main`. Do not use an environment branch rule as the source guard for the staging `workflow_run`: GitHub evaluates that workflow from the default-branch ref, while the workflow's own `check-ci` job verifies the event source is `dev`. If a staging branch policy is enabled, allow the default-branch ref and keep the `dev` check in the workflow. The AWS OIDC roles trust these environment names. Keep `PRODUCTION_DEPLOY_ENABLED=true` only while production is ready. The production workflow checks this switch before and after the environment approval; disabling it does not stop an already running job, so cancel any queued or in-flight production run when pausing releases. Configure a required reviewer for the production environment before the first live release; the manual workflow dispatch is not a substitute for that protection. Restrict who can push to `main` and `dev` using branch protection, and use required CI checks on pull requests.

## AWS infrastructure rollout

1. Confirm the production site's existing Terraform state is the `infra/site` state. Inspect its `terraform plan` before applying changes.
2. Apply the updated `infra/site` stack in its existing state. This creates a production site deploy role and moves site publishing permission from the old application role to the new role. It does not rename or replace the existing production bucket or distribution. Avoid a production site publish between this apply and the workflow cutover.
3. Do not initialize or apply `infra/site-staging` until the staging marketing site is approved and budgeted.
4. Populate the production GitHub environment from the production site Terraform outputs before merging the workflow changes.
5. Provision `evseye-production/razorpay` in production Secrets Manager before the application Terraform apply. Use a JSON secret with live Razorpay values: `RAZORPAY_ENABLED=true`, `RAZORPAY_CLIENT_IDS`, `RAZORPAY_KEY_ID` (`rzp_live_...`), `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `AUTOPAY_PROVIDER=razorpay`, and `RAZORPAY_AUTOPAY_ENABLED=true`. Before rollout, confirm the merchant account supports AutoPay in Live Mode. Use a distinct webhook secret and configure the production Razorpay webhook URL. Start with approved pilot client IDs and verify one-time payment and AutoPay in production before enabling other clients. Never put secret values in Terraform state or Git.
6. After the new workflows have landed on both branches, apply the application Terraform in **each** account to restrict its GitHub OIDC role to `environment:staging` or `environment:production`. Verify the exact repository owner/name supplied through `github_org` and `github_repo`.
7. Set production ECS API and web desired counts above zero before a live cutover; the production verification rejects a zero-running-task bootstrap. Set `staging_account_id` and `staging_aws_region` in the production Terraform inputs. Set `cross_environment_deploy_role_arn` in staging to the production GitHub deploy-role ARN. Apply staging first so its two ECR repository policies allow only production-role image reads; then apply production so its role can read only those staging repositories and continue to push production images.

The site stacks use `ap-south-1` for S3 and `us-east-1` for CloudFront certificates. The production application uses `ap-south-2`; staging application uses `ap-south-1`.

## Cutover and verification

The production workflow definition must be on `main` before it can be dispatched. Keep the final UI changes and this workflow/infra change in the same source tree before the staging run. Push the final candidate to `dev`, confirm CI and staging API/web deployment, then run the focused final staging check in Razorpay Test Mode with synthetic data: review the changed UI, complete one synthetic one-time payment, authorize a synthetic AutoPay mandate, verify one scheduled test charge, and cancel the mandate. Do not use real funds. Record the staging workflow run ID and its provenance artifact only after that check passes. Land the same tree on `main` (the promotion guard rejects a tree mismatch), and dispatch **Deploy — Production** from `main` with `staging_sha` and `staging_run_id`. The workflow promotes the exact staging digests, runs migration before ECS updates, and verifies that the running task definitions use those digests. The `production-2026-11-11` tag is the known release reference for rollback; redeploy a previously promoted digest and matching site files if a release must be reverted.

Deployments are serialized per environment. Staging skips a CI result if its commit is no longer the `dev` tip when deployment starts. Production refuses a non-`main` dispatch, a disabled `PRODUCTION_DEPLOY_ENABLED` flag, a missing successful staging provenance artifact, or a source tree that differs from `main`. Mutating production jobs run only on attempt 1; after a failure, start a fresh manual dispatch instead of re-running failed jobs with retained outputs.
