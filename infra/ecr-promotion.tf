# Allow only the production deployment role to read staging images during the
# explicit promotion workflow. No staging ECS or source-control permissions are
# granted by this policy.
resource "aws_ecr_repository_policy" "staging_api_promotion" {
  count      = var.environment == "staging" && var.cross_environment_deploy_role_arn != "" ? 1 : 0
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "ProductionPromotionRead"
      Effect    = "Allow"
      Principal = { AWS = var.cross_environment_deploy_role_arn }
      Action = [
        "ecr:BatchCheckLayerAvailability",
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer",
      ]
    }]
  })
}

resource "aws_ecr_repository_policy" "staging_web_promotion" {
  count      = var.environment == "staging" && var.cross_environment_deploy_role_arn != "" ? 1 : 0
  repository = aws_ecr_repository.web.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "ProductionPromotionRead"
      Effect    = "Allow"
      Principal = { AWS = var.cross_environment_deploy_role_arn }
      Action = [
        "ecr:BatchCheckLayerAvailability",
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer",
      ]
    }]
  })
}
