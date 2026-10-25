# Pass with: terraform init -reconfigure -backend-config=production.backend.hcl
# Keep this state separate from the staging account and staging/terraform.tfstate.
bucket       = "evseye-terraform-state-735792833529"
key          = "production/terraform.tfstate"
region       = "ap-south-2"
encrypt      = true
use_lockfile = true
