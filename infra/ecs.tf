locals {
  media_base_url     = var.enable_cloudfront ? "https://${var.media_subdomain}.${var.root_domain}" : "https://${aws_s3_bucket.media.bucket_regional_domain_name}"
  client_base_domain = var.environment == "staging" ? "${var.web_subdomain}.${var.root_domain}" : var.root_domain
}

# ─── CloudWatch Log Groups ────────────────────────────────────────────────────


resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${local.name_prefix}/api"
  retention_in_days = 30
  tags              = { Name = "${local.name_prefix}-api-logs" }
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${local.name_prefix}/web"
  retention_in_days = 30
  tags              = { Name = "${local.name_prefix}-web-logs" }
}

resource "aws_cloudwatch_log_group" "migrate" {
  name              = "/ecs/${local.name_prefix}/migrate"
  retention_in_days = 14
  tags              = { Name = "${local.name_prefix}-migrate-logs" }
}

# ─── ECS Cluster ──────────────────────────────────────────────────────────────

resource "aws_ecs_cluster" "main" {
  name = "${local.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = { Name = "${local.name_prefix}-cluster" }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 1
  }
}

# ─── API Task Definition ──────────────────────────────────────────────────────

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name_prefix}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.api_cpu
  memory                   = var.api_memory_mb
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task_api.arn

  container_definitions = jsonencode([{
    name      = "api"
    image     = "${aws_ecr_repository.api.repository_url}:latest"
    essential = true
    portMappings = [{
      containerPort = var.api_port
      protocol      = "tcp"
    }]

    # Non-secret environment variables
    environment = [
      # Staging intentionally uses the repository's development-only console
      # SMS and sandbox KYC adapters. Production must select real adapters.
      { name = "NODE_ENV", value = var.environment == "staging" ? "development" : "production" },
      { name = "API_PORT", value = tostring(var.api_port) },
      { name = "AWS_REGION", value = var.aws_region },
      { name = "APP_BASE_DOMAINS", value = local.client_base_domain },
      { name = "APP_GENERIC_HOSTS", value = "${var.web_subdomain}.${var.root_domain},${var.api_subdomain}.${var.root_domain}" },
      { name = "CORS_ORIGINS", value = "https://${var.web_subdomain}.${var.root_domain}" },
      { name = "CLIENT_LOGIN_URL", value = "https://${var.web_subdomain}.${var.root_domain}" },
      { name = "S3_BUCKET", value = aws_s3_bucket.media.bucket },
      { name = "S3_SERVER_SIDE_ENCRYPTION", value = "AES256" },
      { name = "S3_SIGNED_URL_TTL_SECONDS", value = "300" },
      { name = "MEDIA_PUBLIC_BASE_URL", value = local.media_base_url },
      { name = "JWT_ACCESS_TTL", value = var.jwt_access_ttl },
      { name = "JWT_REFRESH_TTL", value = var.jwt_refresh_ttl },
      { name = "OTP_TTL_SECONDS", value = tostring(var.otp_ttl_seconds) },
      { name = "OTP_MAX_ATTEMPTS", value = tostring(var.otp_max_attempts) },
      { name = "OTP_RESEND_COOLDOWN_SECONDS", value = tostring(var.otp_resend_cooldown_seconds) },
      { name = "API_RATE_LIMIT", value = tostring(var.api_rate_limit) },
      { name = "API_RATE_TTL_MS", value = tostring(var.api_rate_ttl_ms) },
      { name = "IOT_OFFLINE_THRESHOLD_SECONDS", value = tostring(var.iot_offline_threshold_seconds) },
      { name = "SMS_PROVIDER", value = var.sms_provider },
      { name = "KYC_PROVIDER", value = var.kyc_provider },
      { name = "REDIS_URL", value = "rediss://${aws_elasticache_replication_group.main.primary_endpoint_address}:6379" },
    ]

    # Secrets fetched from Secrets Manager at task start
    secrets = [
      {
        name      = "DATABASE_URL"
        valueFrom = "${aws_secretsmanager_secret.database_url.arn}"
      },
      {
        name      = "JWT_ACCESS_SECRET"
        valueFrom = "${aws_secretsmanager_secret.jwt_access.arn}"
      },
      {
        name      = "JWT_REFRESH_SECRET"
        valueFrom = "${aws_secretsmanager_secret.jwt_refresh.arn}"
      },
      {
        name      = "OTP_HASH_SECRET"
        valueFrom = "${aws_secretsmanager_secret.otp_hash.arn}"
      },
      {
        name      = "CLIENT_PROXY_SECRET"
        valueFrom = "${aws_secretsmanager_secret.client_proxy.arn}"
      },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.api.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "api"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://localhost:${var.api_port}/health || exit 1"]
      interval    = 15
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
  }])

  tags = { Name = "${local.name_prefix}-api" }
}

# ─── Web Task Definition ──────────────────────────────────────────────────────

resource "aws_ecs_task_definition" "web" {
  family                   = "${local.name_prefix}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.web_cpu
  memory                   = var.web_memory_mb
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task_web.arn

  container_definitions = jsonencode([{
    name      = "web"
    image     = "${aws_ecr_repository.web.repository_url}:latest"
    essential = true
    portMappings = [{
      containerPort = var.web_port
      protocol      = "tcp"
    }]

    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = tostring(var.web_port) },
      { name = "HOSTNAME", value = "0.0.0.0" },
      { name = "NEXT_PUBLIC_API_URL", value = "https://${var.api_subdomain}.${var.root_domain}/api/v1" },
      { name = "API_INTERNAL_URL", value = "https://${var.api_subdomain}.${var.root_domain}/api/v1" },
    ]

    secrets = [{
      name      = "CLIENT_PROXY_SECRET"
      valueFrom = aws_secretsmanager_secret.client_proxy.arn
    }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.web.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "web"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://localhost:${var.web_port}/ || exit 1"]
      interval    = 15
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
  }])

  tags = { Name = "${local.name_prefix}-web" }
}

# ─── DB Migration Task Definition ─────────────────────────────────────────────
# Run once as a one-shot task before updating ECS services (done in CI/CD).

resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.name_prefix}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task_api.arn

  container_definitions = jsonencode([{
    name      = "migrate"
    image     = "${aws_ecr_repository.api.repository_url}:latest"
    essential = true

    command = [
      "./apps/api/node_modules/.bin/prisma",
      "migrate",
      "deploy",
      "--schema=apps/api/prisma/schema.prisma",
    ]

    secrets = [{
      name      = "DATABASE_URL"
      valueFrom = aws_secretsmanager_secret.database_url.arn
    }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.migrate.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "migrate"
      }
    }
  }])

  tags = { Name = "${local.name_prefix}-migrate" }
}

# ─── ECS Services ─────────────────────────────────────────────────────────────

resource "aws_ecs_service" "api" {
  name                   = "${local.name_prefix}-api"
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.api.arn
  desired_count          = var.api_desired_count
  launch_type            = "FARGATE"
  enable_execute_command = true

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = var.api_port
  }

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  lifecycle {
    ignore_changes = [task_definition] # CI/CD manages task def updates
  }

  depends_on = [aws_lb_listener.https]

  tags = { Name = "${local.name_prefix}-api" }
}

resource "aws_ecs_service" "web" {
  name            = "${local.name_prefix}-web"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = var.web_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = var.web_port
  }

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  lifecycle {
    ignore_changes = [task_definition]
  }

  depends_on = [aws_lb_listener.https]

  tags = { Name = "${local.name_prefix}-web" }
}
