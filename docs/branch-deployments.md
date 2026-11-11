# Branch-driven deployments

| Branch | CI | API and web | Marketing site |
| --- | --- | --- | --- |
| `dev` | Every push and pull request | Staging ECS, `ap-south-1` | Not deployed yet |
| `main` | Every push and pull request | Production ECS, `ap-south-2` when enabled | `https://www.evseye.com/` when enabled |

The deployment workflows run only after a successful **push** CI run. They check that the commit is still the tip of its branch, then deploy the exact commit SHA that passed CI. A pull request CI run does not deploy. API and web Docker images use the commit SHA as their ECR tag; no shared `latest` tag is written. Migration runs before the ECS services update. Marketing site publication runs after CI and then invalidates its CloudFront distribution.
The staging marketing site is intentionally deferred to avoid additional AWS costs. The `infra/site-staging` Terraform root remains available for a later opt-in rollout, but it must not be initialized or applied now.

## GitHub environments

Create GitHub Actions environments named `staging` and `production`. They are used by the API/web and site jobs. Set `PRODUCTION_DEPLOY_ENABLED=false` as a production environment variable until production infrastructure and secrets are ready. Set it to `true` only after the production cutover checklist is complete. Set the following **environment secrets** independently in each environment:

| Secret | Source |
| --- | --- |
| `AWS_ROLE_ARN` | Application Terraform `github_actions_role_arn` output for that environment. |
| `SITE_AWS_ROLE_ARN` | `infra/site` `github_actions_role_arn` output for the production site. No staging site role is needed while staging site deployment is deferred. |
| `ECR_API_REPO`, `ECR_WEB_REPO`, `ECR_API_URL` | That environment's ECR repositories and full API repository URL. |
| `ECS_CLUSTER`, `ECS_API_SERVICE`, `ECS_WEB_SERVICE` | That environment's ECS cluster and service names. |
| `ECS_API_TASK`, `ECS_WEB_TASK`, `ECS_MIGRATE_TASK`, `ECS_TASK_SG` | That environment's ECS task definition families and task security group. |
| `WEB_URL`, `API_URL` | That environment's hostnames, without `https://`. |

Set these **production environment variables** from the production site Terraform outputs:

- `SITE_BUCKET` = `site_bucket`
- `SITE_DISTRIBUTION_ID` = `cloudfront_distribution_id`

Remove or migrate same-named repository-level secrets and variables. Environment values take precedence, but retaining shared deployment values makes misconfiguration harder to spot. Set the staging environment's deployment branch rule to `dev` and production's to `main`; the AWS OIDC roles trust these environment names. Do not configure an environment approval rule if pushes should deploy automatically. Restrict who can push to `main` and `dev` using branch protection, and use required CI checks on pull requests.

## AWS infrastructure rollout

1. Confirm the production site's existing Terraform state is the `infra/site` state. Inspect its `terraform plan` before applying changes.
2. Apply the updated `infra/site` stack in its existing state. This creates a production site deploy role and moves site publishing permission from the old application role to the new role. It does not rename or replace the existing production bucket or distribution. Avoid a production site publish between this apply and the workflow cutover.
3. Do not initialize or apply `infra/site-staging` until the staging marketing site is approved and budgeted.
4. Populate the production GitHub environment from the production site Terraform outputs before merging the workflow changes.
5. After the new workflows have landed on both branches, apply the application Terraform in **each** account to restrict its GitHub OIDC role to `environment:staging` or `environment:production`. Verify the exact repository owner/name supplied through `github_org` and `github_repo`.

The site stacks use `ap-south-1` for S3 and `us-east-1` for CloudFront certificates. The production application uses `ap-south-2`; staging application uses `ap-south-1`.

## Cutover and verification

Deploy these workflow changes to the repository's default branch (`main`), because GitHub executes `workflow_run` workflow definitions from the default branch. Merge the same commit into `dev`. Configure the staging application GitHub values first, then push a change to `dev` and confirm successful CI and staging API/web deployment. Finally push or merge a reviewed change to `main` and confirm the production API/web and marketing site deployments. The `production-2026-11-11` tag is the known release reference for rollback; redeploy a previously built SHA image and matching site files if a release must be reverted.

Deployments are serialized per environment. The workflow skips a CI result if its commit is no longer the branch tip when deployment starts. A newer push during an already running deployment will queue behind it and deploy afterward.
