# EVsEye production rollout — Hyderabad

Production account: `735792833529`. Region: `ap-south-2`. Staging stays in account `591132358460` and is delegated to `staging.evseye.com`. This runbook does not change staging DNS or the existing `evseye.com` and `www.evseye.com` CloudFront aliases.

## Current gate

The user accepted an AWS production planning ceiling of **$150/month** on 2026-10-08, excluding Telipia SMS, MSG91 email, Sandbox KYC, and other vendor charges. The user reports that the AWS Budgets alert has been updated to **$150/month**; verify it in AWS when an authenticated account session is available. A budget alert does not cap spending. AWS account verification is still in progress, so wait for AWS to confirm resource creation before applying the billable stack. Review the latest production plan before applying. AWS's Hyderabad on-demand catalog lists ALB at $0.0239/hour, Multi-AZ PostgreSQL `db.t4g.micro` at $0.042/hour, Redis `cache.t4g.micro` at $0.02/hour, and Fargate at $0.04256/vCPU-hour plus $0.00466/GB-hour. One public IPv4 address is $0.005/hour. These are public list prices queried through the [AWS Price List API](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/using-price-list-query-api.html); they do not include credits or taxes.

The revised production configuration removes the NAT gateway by placing only the ECS tasks in public subnets with public IPs. Their security group accepts inbound traffic solely from the ALB; the database and Redis stay in private database subnets. At 730 hours, the planned always-on components, 20 GB RDS storage, nine secret containers, one hosted zone, and public IPv4 addresses total about **$79.35/month** while ECS services are stopped. With one API and one web task, the known base is about **$105.58/month**. Two of each would raise it to about **$131.82/month before variable charges**, leaving too little margin under the accepted $150 ceiling for an initial launch. The forecast for the stated workload (50 scooters, 650 rider records, 7,500 new photos of 2 MB each, and 200 small spreadsheets per month) is **$115–$140/month**, excluding vendor charges and taxes. The initial launch recommendation remains one task per service; one task per service has an availability risk. Use the [AWS Pricing Calculator](https://calculator.aws/) with **Asia Pacific (Hyderabad)** and measured traffic/storage before scaling. Keep Multi-AZ database protection unless a deliberate availability decision changes it.

The new `production.tfvars.example` starts API and web ECS services at zero tasks. This prevents repeated failed image pulls while the repositories and secrets are prepared, but **the rest of the stack still starts billing immediately after apply**. The selected vendors are Telipia for SMS, MSG91 for email, and Sandbox for KYC. KYC starts with `kyc_enabled = false` until live credentials and the production provider record are ready. No IoT or SIM service is provisioned.

## Local access and plan

Use the existing short-lived AWS CLI login and credential-process bridge; do not create IAM access keys. In `infra/`:

```sh
export AWS_PROFILE=evseye-prod-tf
aws sts get-caller-identity --region ap-south-2
terraform init -reconfigure -backend-config=production.backend.hcl
terraform validate
terraform plan -var-file=production.tfvars.example -input=false
```

Confirm account `735792833529`, region `ap-south-2`, hosted zone `Z00675772S7AEIZEMRYG1`, and no proposed changes or deletions to existing resources. The read-only plan on 2026-10-07 showed **87 to add, 0 to change, 0 to destroy**, with both ECS service counts at zero. Review the plan before every apply; the count may change as code evolves. The new production state uses `s3://evseye-terraform-state-735792833529/production/terraform.tfstate` with S3 locking.

## Bootstrap sequence after the cost decision

1. Check the AWS Support case and regional quotas. The account still reports verification in progress despite customer verification showing **Verified**. A successful plan confirms read permissions, not resource-creation permission. Do not apply while this status persists.
2. Apply the reviewed bootstrap configuration with both desired counts at zero. The infrastructure will create ECR repositories, a database, Redis, networking, TLS, a private media bucket, and a production Telipia secret container. There is no application traffic at this point.
3. After committing the reviewed code, build and push API and web images to the new account's ECR repositories with `AWS_PROFILE=evseye-prod-tf bash scripts/push-production-images.sh` from the repository root. The script checks the account and refuses a dirty worktree. The staging workflow uses the old account and must not be reused with production credentials. A dedicated production workflow is still needed before automatic deployment.
4. In **Secrets Manager, Hyderabad**, set JSON values for Telipia and MSG91 before starting the API. Terraform owns each secret container and IAM access, not its value. The existing local ignored `.env` has the MSG91 settings; transfer them through a secure local workflow without printing the auth key. The Telipia settings were not found in that file, so retrieve the previously supplied live values through the secure channel where they were originally stored. Never put credentials in Terraform variables, Git, terminal history, or this chat.

   | Secret | Required JSON keys | Prerequisite |
   | --- | --- | --- |
   | `evseye-production/telipia` | `api_url`, `username`, `api_key`, `sender`, `login_template_id` | Verified HTTPS endpoint and approved DLT sender/template |
   | `evseye-production/msg91-email` | `auth_key`, `email_domain`, `email_from`, `welcome_template_id` | MSG91 sender domain and template verified; check its DNS requirements against existing Mailer91 records |
   | `evseye-production/sandbox-kyc` | `api_key`, `api_secret`, `fingerprint_secret` | **Later**, once Sandbox live KYC access is available; this value is not required while `kyc_enabled = false` |
5. Run the Prisma production migration task exactly once against the new database. In the ECS console in Hyderabad, open the production cluster, choose **Run task**, select the latest `evseye-production-migrate` task definition and Fargate launch type, select the two subnet IDs from `terraform output ecs_task_subnet_ids`, select the group from `terraform output ecs_task_security_group_id`, and enable **Public IP** as indicated by `terraform output ecs_task_assign_public_ip`. Wait for **Stopped**, inspect the migration container's exit code (must be `0`) and `/ecs/evseye-production/migrate` CloudWatch logs. The old `ecs_private_subnet_ids` output is for staging. Do not run development seeds or repeat a successful migration merely because a later task failed.
6. After the live Sandbox credentials are stored, run the production-only `evseye-production-kyc-seed` task once using the same subnet, security group, and Public IP settings as the migration task. It creates the live Sandbox provider, credential reference, PAN/IFSC capabilities, and routing/workflow definitions without demo users or fleets. Confirm container exit code `0` and the `kyc-seed` CloudWatch stream. Set `kyc_enabled = true` in the reviewed launch plan only if live vendor access, consent, and per-call budget are approved; otherwise leave it false and activate KYC in a later deployment. Sandbox's vendor name does **not** mean the TEST endpoint: production uses `https://api.sandbox.co.in`, while staging stays on `https://test-api.sandbox.co.in`.
7. Enable `enable_cloudfront = true` and review/apply the resulting media distribution and DNS certificate changes. The media bucket is private; its S3 URL is not a working public media URL. CloudFront must be available in the new account before public launch.
8. Set `api_desired_count = 1` and `web_desired_count = 1`, review the new plan, and apply. Increase to two each only if the accepted cost/availability plan calls for it. Confirm ECS services stable, `https://api.evseye.com/health` and `https://app.evseye.com/`, TLS, login OTP delivery, MSG91 welcome email, public media, and client isolation. If KYC was enabled, make one consented live verification and inspect the safe audit trail and provider charge.
9. Keep the existing apex, `www`, mail, and staging delegation records. Change only the intended production application records. Verify public DNS from multiple resolvers and monitor the first 24 hours of logs, alarms, and cost usage.

## Release blockers

- The user has the live Telipia settings handy, but they are not present in the current local `.env`. Transfer the verified HTTPS endpoint, username, API key, sender, and approved DLT template into the production secret after bootstrap and before API replicas start. The API refuses the `console` SMS adapter in production. The previously documented `telipiacloud.in` host had a TLS hostname mismatch; confirm the correct provider endpoint before using it.
- The user reports MSG91 is ready and its auth settings are in the local ignored `.env`. Transfer them into the production secret after bootstrap. Verify the sender domain/template and any required DNS records before API replicas start. Existing `mail.evseye.com` records point to Mailer91; do not assume they authorize MSG91 sending.
- Sandbox KYC needs **live** API access. The application now has separate TEST and PRODUCTION hosts and secret references, but vendor subscription/permissions, live credentials, consent, KYC seeding, and a controlled live verification remain prerequisites before `kyc_enabled = true`.
- The current repository has only a staging deployment workflow. Production image publication and ECS rollout need a dedicated workflow or a controlled manual procedure.
- CloudFront account eligibility and DNS certificate validation must succeed before public media delivery.
- The accepted AWS planning ceiling is $150/month, and the user reports that the AWS Budgets alert is now $150/month. Verify the alert and confirm account resource-creation eligibility before creating the always-on stack.
