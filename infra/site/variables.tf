variable "aws_region" {
  type    = string
  default = "ap-south-1"
}

variable "root_domain" {
  type    = string
  default = "evseye.com"
}

variable "github_deploy_role_name" {
  type    = string
  default = "evseye-staging-github-actions-deploy"
}
