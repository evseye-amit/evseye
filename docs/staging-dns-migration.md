# Move staging DNS to the delegated zone

This runbook is for **staging in AWS account 591132358460**. The child hosted zone is `staging.evseye.com`. The existing `evseye.com` parent zone and GoDaddy nameservers remain in service while production is prepared in account 735792833529. The staging ALB and applications stay in the old account.

## 0. Prepare AWS CloudShell

The updated Terraform configuration is currently in the local EVsEye workspace. It does not appear in CloudShell automatically, and a Git commit is not needed for this CloudShell workflow.

Download `staging-dns-migration-upload.tar.gz` from the EVsEye workspace. In **CloudShell for account 591132358460**, choose **Actions → Upload file** and select that archive. Then run:

```bash
ls -lh ~/staging-dns-migration-upload.tar.gz
mkdir -p ~/evseye-staging-dns-migration
tar -xzf ~/staging-dns-migration-upload.tar.gz -C ~/evseye-staging-dns-migration
cd ~/evseye-staging-dns-migration
grep -q 'application_web' infra/route53.tf && echo 'Updated files present'
```

Do not continue unless the last command prints `Updated files present`.

Install Terraform in CloudShell with HashiCorp's official Amazon Linux package repository:

```bash
sudo yum install -y yum-utils shadow-utils
sudo yum-config-manager --add-repo https://rpm.releases.hashicorp.com/AmazonLinux/hashicorp.repo
sudo yum install -y terraform
terraform version
```

If `sudo yum` or the repository command fails, stop and record the exact error. Do not substitute an unknown Terraform download or run the plan from a different configuration directory.

## 1. Check the child zone and save Terraform state

Sign in to the staging account and confirm that the `staging.evseye.com` public hosted zone has these nameservers:

```text
ns-931.awsdns-52.net.
ns-1914.awsdns-47.co.uk.
ns-371.awsdns-46.com.
ns-1165.awsdns-17.org.
```

Confirm its seven records: NS, SOA, A aliases for `staging.evseye.com`, `*.staging.evseye.com`, and `api.staging.evseye.com`, plus the two existing ACM validation CNAMEs. Confirm the three aliases still target the existing staging ALB. Check Route 53's **Test record** for the A records and both CNAMEs.

From the prepared CloudShell directory, authenticated to **account 591132358460**:

```bash
aws sts get-caller-identity
cd ~/evseye-staging-dns-migration/infra
terraform init
umask 077
terraform state pull > ~/staging-terraform-state-backup.json
test -s ~/staging-terraform-state-backup.json && echo 'State backup saved'
terraform state list
```

Keep the state backup private; it can contain secrets. Do not commit it. Use Terraform 1.10 or newer, as required by this project.

## 2. Review the migration plan

```bash
terraform fmt -check
terraform validate
terraform plan -out=staging-dns-migration.tfplan
```

Review **every** proposed change. The old `aws_route53_zone.main` and old parent-zone `aws_route53_record.*` addresses should say they are **removed from state but not destroyed**. The new `application_*` records should be created in the existing `staging.evseye.com` zone. Their `allow_overwrite` setting lets Route 53 update matching records that you already copied there. The ALB certificate may be replaced with one covering only staging names, and the HTTPS listener should move to the newly validated certificate.

**Stop if the plan proposes deleting the `evseye.com` parent hosted zone, its existing DNS records, the staging ALB, or the staging application stack.** Resolve the plan before applying. The same rule applies to any other unexpected replacement or deletion.

## 3. Delegate staging from the old parent zone

In the **old account's `evseye.com` parent hosted zone**, create an **NS** record named `staging.evseye.com` with the four child-zone nameservers above. Set TTL to 300 seconds if the console allows it. Do not change nameservers in GoDaddy at this step.

Wait for public DNS to return the child nameservers and verify `staging.evseye.com`, `api.staging.evseye.com`, and a test name such as `test.staging.evseye.com` resolve to the staging ALB. Confirm the staging web and API work over HTTPS. Also verify the two ACM CNAMEs publicly resolve to their existing `acm-validations.aws` targets. Route 53 **Test record** checks the selected zone only; public checks confirm delegation.

If delegation causes a problem, delete **only** the new staging NS record from the old parent zone. Its old staging records are intentionally still present for this rollback.

## 4. Apply Terraform in the staging account

After the delegated names work publicly and the plan is still current:

```bash
terraform apply staging-dns-migration.tfplan
terraform output name_servers
```

The output should match the child-zone nameservers. Confirm the replacement ACM certificate is **Issued**, the ALB HTTPS listener uses it, the staging target groups are healthy, and both staging web and API respond over HTTPS. If the saved plan has expired because state or configuration changed, make and review a fresh plan before applying.

## 5. Remove duplicate staging records from the old parent zone

Only after the Terraform apply and public checks succeed, remove the **five duplicate staging records** from the old `evseye.com` parent zone: the three staging A aliases and the two staging ACM CNAMEs. Leave the `staging.evseye.com` **NS delegation record** in the parent zone. Leave all apex, `www`, mail, and other non-staging records untouched. The child zone is now the staging DNS source of truth.

ACM uses the same CNAME to validate `staging.evseye.com` and `*.staging.evseye.com`. The first apply tracked that physical CNAME under both Terraform addresses. After uploading the revised configuration containing the `if dvo.domain_name != local.dns_zone_name` filter, forget the redundant apex address **from state only**:

```bash
cd ~/evseye-staging-dns-migration/infra
terraform state pull > ~/staging-terraform-state-after-dns-migration.json
test -s ~/staging-terraform-state-after-dns-migration.json && echo 'Post-migration backup saved'
terraform state rm 'aws_route53_record.application_alb_cert_validation["staging.evseye.com"]'
terraform validate
terraform plan
```

`terraform state rm` must say one instance removed. It does not delete the Route 53 CNAME. The subsequent plan should show no DNS, certificate, ALB, or application changes. Stop and investigate if it does. Do not run `state rm` against the other wildcard or API validation address.

If a previous plan displayed updates only to add a trailing dot to the two ACM CNAME target values, use the revised `acm.tf` with `trimsuffix(each.value.record, ".")` and rerun `terraform plan`; the Route 53 values are already correct and need no DNS update.

## 6. Carry delegation into the production parent zone later

Before switching GoDaddy nameservers to the new production account's `evseye.com` hosted zone, create the **same** `staging.evseye.com` NS delegation in that new parent zone. Copy and verify all required non-staging records there as part of the production DNS migration. Keep the old parent zone until the registrar cutover and public DNS have settled; do not delete it as part of this staging change.

If Terraform apply fails, keep both zones and the old parent records. Inspect the failure and make a fresh plan. To revert DNS traffic while investigating, remove the staging NS delegation from the old parent zone. Do not delete the child zone or push the state backup without a specific recovery plan.
