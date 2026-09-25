output "site_bucket" {
  value = aws_s3_bucket.site.bucket
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.site.id
}

output "github_actions_role_arn" {
  value = data.aws_iam_role.github_actions_deploy.arn
}

output "site_url" {
  value = "https://www.${var.root_domain}/"
}
