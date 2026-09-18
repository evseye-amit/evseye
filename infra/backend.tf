# Remote state is stored in S3 with native S3 lock-file support.
# Create the bucket before running `terraform init` (see docs/aws-setup.md).
# The bucket name below is intentionally account-specific; update it when
# deploying this configuration into a different AWS account.

terraform {
  backend "s3" {
    bucket       = "evseye-terraform-state-591132358460"
    key          = "staging/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true # Native S3 locking (Terraform ≥1.10)
  }
}
