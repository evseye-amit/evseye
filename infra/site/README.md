# Public marketing site deployment

This standalone Terraform root creates a private S3 bucket, a separate CloudFront distribution with origin access control, an ACM certificate in `us-east-1`, Route 53 records for `www.evseye.com` and `evseye.com`, and an apex-to-www redirect. It attaches narrowly scoped publishing permissions to the **existing** GitHub Actions deployment role. It uses separate Terraform state from the API/web infrastructure. It does not create an S3 website endpoint or expose bucket objects publicly.

## Prerequisites

1. Run Terraform with an AWS principal authorized to create S3, CloudFront, ACM, Route 53, and to attach a policy to the existing GitHub Actions role. Check `aws sts get-caller-identity`. The existing deployment role's checked-in policy covers ECR/ECS only, so it cannot bootstrap these resources itself. This root does not create or change registrar nameservers.
2. Confirm the hosted zone is authoritative for the domain. Review any existing apex or `www` A/AAAA records before applying. Import an existing record into this state or plan its handoff; do not create a competing record.
3. Move the production client operations web address to `app.evseye.com` before handing `www` to CloudFront. The application Terraform uses `var.web_subdomain` for its ALB alias; set that to `app` in a production application deployment. Retain wildcard client hosts and `api.evseye.com` on the ALB.
4. Confirm the AWS account can create CloudFront distributions. The current media distribution is gated separately in `infra/`; the marketing distribution does not depend on it.
5. Review public claims and contact details in `apps/site/index.html` before launch. The unpublished blog is omitted from the build.
6. The role looked up by Terraform defaults to `evseye-staging-github-actions-deploy`. Set `github_deploy_role_name` if the `AWS_ROLE_ARN` secret names a different existing role.

## Provision

```sh
cd infra/site
terraform init
terraform plan -out=site.tfplan
terraform apply site.tfplan
terraform output site_bucket
terraform output cloudfront_distribution_id
terraform output github_actions_role_arn
```

The backend key is `marketing-site/terraform.tfstate` in the existing account's state bucket. For another AWS account, update the backend bucket first. ACM validation requires working authoritative DNS and can remain pending until delegation is correct.

Set the following GitHub repository **Actions variables** from the Terraform outputs:

- `SITE_BUCKET` = `site_bucket`
- `SITE_DISTRIBUTION_ID` = `cloudfront_distribution_id`
- `SITE_DEPLOY_ENABLED` = `true` after the resources and DNS cutover are ready

Run **Deploy marketing site** in GitHub Actions for the first upload. Subsequent changes under `apps/site/` on `main` publish automatically. The workflow builds the site, syncs only `dist/`, gives HTML a no-cache directive, and invalidates CloudFront. GitHub receives short-lived AWS credentials through OIDC; no AWS access key is stored in the repository.

The workflow reuses the repository's existing `AWS_ROLE_ARN` secret. Its publishing policy is added by this Terraform root after the site resources exist. Keep `SITE_DEPLOY_ENABLED` unset until the first Terraform apply and application-domain cutover are complete.

## Verify

```sh
curl -I https://www.evseye.com/
curl -I https://www.evseye.com/assets/styles.css
curl -I https://www.evseye.com/blog.html
curl -I https://evseye.com/
```

Expect 200 for the home page and stylesheet, 404 for the unpublished blog, and 301 from the apex domain to `www`. Check the rendered page in a browser at desktop and mobile widths. A fresh distribution may briefly return 404 until the first upload and invalidation finish.
