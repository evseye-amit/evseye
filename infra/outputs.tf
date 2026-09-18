output "alb_dns_name" {
  description = "ALB DNS name (use this to test before DNS is set up)."
  value       = aws_lb.main.dns_name
}

output "web_url" {
  description = "Staging web URL."
  value       = "https://${var.web_subdomain}.${var.root_domain}"
}

output "api_url" {
  description = "Staging API base URL."
  value       = "https://${var.api_subdomain}.${var.root_domain}"
}

output "media_cdn_url" {
  description = "Media CDN URL (CloudFront when enabled, S3 bucket URL when disabled)."
  value       = var.enable_cloudfront ? "https://${var.media_subdomain}.${var.root_domain}" : "https://${aws_s3_bucket.media.bucket_regional_domain_name}"
}

output "ecr_api_url" {
  description = "ECR repository URL for API image."
  value       = aws_ecr_repository.api.repository_url
}

output "ecr_web_url" {
  description = "ECR repository URL for Web image."
  value       = aws_ecr_repository.web.repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name (needed for deploy workflow)."
  value       = aws_ecs_cluster.main.name
}

output "ecs_api_service_name" {
  description = "ECS API service name."
  value       = aws_ecs_service.api.name
}

output "ecs_web_service_name" {
  description = "ECS Web service name."
  value       = aws_ecs_service.web.name
}

output "ecs_migrate_task_family" {
  description = "ECS migrate task definition family name."
  value       = aws_ecs_task_definition.migrate.family
}

output "ecs_private_subnet_ids" {
  description = "Private subnet IDs (used by CI/CD to run migrate task)."
  value       = aws_subnet.private[*].id
}

output "ecs_task_security_group_id" {
  description = "Security group for ECS tasks (used by CI/CD to run migrate task)."
  value       = aws_security_group.ecs_tasks.id
}

output "github_actions_role_arn" {
  description = "IAM role ARN for GitHub Actions OIDC — add this to GitHub repo secrets as AWS_ROLE_ARN."
  value       = aws_iam_role.github_actions_deploy.arn
}

output "name_servers" {
  description = "Route 53 name servers — update your domain registrar to point to these."
  value       = aws_route53_zone.main.name_servers
}

output "rds_endpoint" {
  description = "RDS endpoint (for connection string construction)."
  value       = aws_db_instance.main.endpoint
  sensitive   = true
}
