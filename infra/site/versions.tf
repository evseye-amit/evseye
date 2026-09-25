terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }

  # Separate state from the application stack. The bucket is already used by
  # this repository; change it only when bootstrapping a different AWS account.
  backend "s3" {
    bucket       = "evseye-terraform-state-591132358460"
    key          = "marketing-site/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project   = "evseye"
      Component = "marketing-site"
      ManagedBy = "terraform"
    }
  }
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = {
      Project   = "evseye"
      Component = "marketing-site"
      ManagedBy = "terraform"
    }
  }
}
