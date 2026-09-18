# EVs Eye — AWS Setup Guide (Beginner-Friendly)

This guide walks you through everything from creating a brand-new AWS account to your first staging deployment. Follow the steps in order.

---

## Prerequisites (install on your Mac)

```bash
# Install Homebrew (if not already installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install AWS CLI, Terraform, and Git
brew install awscli terraform git
```

Verify:
```bash
aws --version      # aws-cli/2.x
terraform -version # Terraform v1.10+
```

---

## Step 1 — Create Your AWS Account (~10 min)

1. Go to **https://aws.amazon.com** and click **"Create an AWS Account"**.
2. Use the email address for the AWS account owner.
3. Account name: `evseye`
4. Choose **Personal** account type.
5. Add a credit/debit card (won't be charged unless you exceed free tier — staging costs ~$95/mo which you will incur).
6. Choose the **Basic (free) support plan**.
7. Sign in to the **AWS Management Console**.

> [!IMPORTANT]
> **Enable MFA on the root account immediately** — this is non-negotiable for security.
> Console → top-right account menu → "Security credentials" → "Assign MFA device" → use Google Authenticator or Authy.

---

## Step 2 — Create an IAM Admin User (~10 min)

Never use the root account day-to-day. Create an admin IAM user instead.

1. In the console, search for **IAM** and open it.
2. Click **Users** → **Create user**.
3. Username: choose an account-specific administrator name.
4. Check **"Provide user access to the AWS Management Console"** → **"I want to create an IAM user"**
5. Set a password.
6. Click **Next** → **Attach policies directly** → search for and check **AdministratorAccess**.
7. Click **Create user** → download the CSV with credentials.
8. Sign out of root and sign in as the administrator you created.
9. Enable MFA on this user too (same steps as above).

---

## Step 3 — Create Terraform State Infrastructure (~5 min)

Terraform stores its state (a record of what it created) in S3. This must exist before you run `terraform init`.

### 3a. Find your Account ID

```bash
aws sts get-caller-identity --query Account --output text
```

Copy the 12-digit number. We'll call it `<ACCOUNT_ID>`.

### 3b. Configure AWS CLI

```bash
aws configure
# AWS Access Key ID:     (from the CSV you downloaded in Step 2)
# AWS Secret Access Key: (from the CSV)
# Default region name:   ap-south-1
# Default output format: json
```

### 3c. Create the S3 state bucket

```bash
aws s3api create-bucket \
  --bucket evseye-terraform-state-<ACCOUNT_ID> \
  --region ap-south-1 \
  --create-bucket-configuration LocationConstraint=ap-south-1

aws s3api put-bucket-versioning \
  --bucket evseye-terraform-state-<ACCOUNT_ID> \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket evseye-terraform-state-<ACCOUNT_ID> \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

aws s3api put-public-access-block \
  --bucket evseye-terraform-state-<ACCOUNT_ID> \
  --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

### 3d. Confirm the Terraform backend

The repository already enables the S3 backend in `infra/backend.tf` and uses
Terraform's native S3 lock file (`use_lockfile = true`). The checked-in backend
currently targets `evseye-terraform-state-591132358460`; if you are deploying
to another AWS account, update that bucket name before running `terraform init`.

S3 locking is enabled automatically by the backend.

---

## Step 4 — Register the OIDC Provider in IAM (~2 min)

GitHub Actions uses OIDC to get temporary AWS credentials. Run this once:

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

If it says "already exists", that's fine — skip.

---

## Step 5 — Run Terraform (~15 min)

```bash
cd infra

# Initialise — downloads providers and connects to remote state
terraform init

# Preview what will be created (dry run — no changes yet)
terraform plan

# Create all infrastructure — takes ~10–15 minutes
terraform apply
```

When prompted "Do you want to perform these actions?" type `yes`.

After it completes, note these outputs:

```bash
terraform output name_servers       # → 4 NS records for your domain registrar
terraform output github_actions_role_arn
terraform output ecr_api_url
terraform output ecr_web_url
terraform output ecs_cluster_name
terraform output ecs_api_service_name
terraform output ecs_web_service_name
```

---

## Step 6 — Point Your Domain to AWS (~5 min + up to 48h propagation)

1. Log in to wherever you bought `evseye.com` (GoDaddy, Namecheap, Google Domains, etc.).
2. Find **DNS settings** or **Nameservers**.
3. Replace the existing nameservers with the 4 NS values from `terraform output name_servers`.
4. Save. DNS propagation can take up to 48 hours, but is usually done in 1–2 hours.

> [!NOTE]
> You can test the ALB immediately (before DNS propagates) by using the raw ALB DNS name:
> `curl http://$(terraform output -raw alb_dns_name)/health`

---

## Step 7 — Add GitHub Secrets (~5 min)

In your GitHub repo, go to **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret name | Value (from `terraform output`) |
|-------------|----------------------------------|
| `AWS_ROLE_ARN` | `terraform output -raw github_actions_role_arn` |
| `ECR_API_REPO` | Last part of `terraform output -raw ecr_api_url` (e.g. `evseye-staging-api`) |
| `ECR_WEB_REPO` | Last part of `terraform output -raw ecr_web_url` |
| `ECS_CLUSTER` | `terraform output -raw ecs_cluster_name` |
| `ECS_API_SERVICE` | `terraform output -raw ecs_api_service_name` |
| `ECS_WEB_SERVICE` | `terraform output -raw ecs_web_service_name` |
| `ECS_API_TASK` | `evseye-staging-api` |
| `ECS_WEB_TASK` | `evseye-staging-web` |
| `ECS_MIGRATE_TASK` | `terraform output -raw ecs_migrate_task_family` |
| `ECS_PRIVATE_SUBNETS` | `terraform output -json ecs_private_subnet_ids \| jq -r 'join(",")'` |
| `ECS_TASK_SG` | `terraform output -raw ecs_task_security_group_id` |
| `ECR_API_URL` | Full URL from `terraform output -raw ecr_api_url` |
| `WEB_URL` | `staging.evseye.com` |
| `API_URL` | `api.staging.evseye.com` |

---

## Step 8 — First Deployment

Push to `main` (or trigger the workflow manually from GitHub → Actions → "Deploy — Staging" → "Run workflow").

The workflow will:
1. Build Docker images and push to ECR (~5–8 min)
2. Run Prisma DB migration (one-shot ECS task, ~1 min)
3. Update ECS services with the new images (~3–5 min)

Watch progress in GitHub Actions. When all jobs are green ✅:

```bash
# Test API health
curl https://api.staging.evseye.com/health
# → {"data":{"status":"ok","service":"evs-eye-api"}}

curl https://api.staging.evseye.com/health/ready
# → {"status":"ready","data":{"status":"ready","service":"evs-eye-api","database":"ok"}}

# Open the web app
open https://staging.evseye.com
```

---

## Step 9 — Enable Billing Alerts (strongly recommended)

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "evseye-monthly-billing-150usd" \
  --alarm-description "Alert when estimated charges exceed $150" \
  --metric-name EstimatedCharges \
  --namespace AWS/Billing \
  --statistic Maximum \
  --period 86400 \
  --threshold 150 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=Currency,Value=USD \
  --evaluation-periods 1 \
  --alarm-actions arn:aws:sns:us-east-1:<ACCOUNT_ID>:billing-alerts \
  --region us-east-1
```

> [!TIP]
> Also enable **AWS Cost Anomaly Detection** in the console (Billing → Cost Anomaly Detection → Create monitor). It's free and catches unexpected spend automatically.

---

## Troubleshooting

### ECS task keeps restarting
```bash
# View API container logs
aws logs tail /ecs/evseye-staging/api --follow
```

### Migration failed
```bash
# View migration logs
aws logs tail /ecs/evseye-staging/migrate --follow
```

### `terraform apply` fails with "already exists"
Some resources (like the OIDC provider) may already exist. Run `terraform import` or add a `count = 0` guard — the error message will tell you the resource ARN.

---

## Next Steps (after staging is stable)

- [ ] Decide on a real **SMS provider** (Twilio, MSG91, AWS SNS Transactional SMS)
- [ ] Decide on a **KYC provider** (Hyperverge, Karza, NDML)
- [ ] Create a `production` Terraform workspace with Multi-AZ RDS and 2 ECS tasks
- [ ] Set up CloudWatch alarms on ALB 5xx errors and ECS CPU/memory
- [ ] Enable AWS WAF on the ALB (protects against common web attacks)
