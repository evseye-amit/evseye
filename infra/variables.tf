variable "aws_region" {
  description = "AWS region for all primary resources."
  type        = string
  default     = "ap-south-1"
}

variable "environment" {
  description = "Deployment environment name (staging | production)."
  type        = string
  default     = "staging"
}

variable "project" {
  description = "Project short name used in resource naming."
  type        = string
  default     = "evseye"
}

# ─── Networking ───────────────────────────────────────────────────────────────

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.0.0.0/16"
}

# ─── Domain ───────────────────────────────────────────────────────────────────

variable "root_domain" {
  description = "Root domain registered in (or to be delegated to) Route 53."
  type        = string
  default     = "evseye.com"
}

variable "web_subdomain" {
  description = "Subdomain for the web app (staging = 'staging', production = 'app'; www is reserved for the marketing site)."
  type        = string
  default     = "staging"
}

variable "api_subdomain" {
  description = "Subdomain for the API (e.g. 'api.staging' or 'api')."
  type        = string
  default     = "api.staging"
}

variable "media_subdomain" {
  description = "Subdomain for the CloudFront media CDN."
  type        = string
  default     = "media.staging"
}

# ─── RDS ──────────────────────────────────────────────────────────────────────

variable "db_instance_class" {
  description = "RDS instance type."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage_gb" {
  description = "Initial RDS storage in GB."
  type        = number
  default     = 20
}

variable "db_multi_az" {
  description = "Enable Multi-AZ for RDS. Set true for production."
  type        = bool
  default     = false
}

# ─── ElastiCache ──────────────────────────────────────────────────────────────

variable "redis_node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.t4g.micro"
}

# ─── ECS ──────────────────────────────────────────────────────────────────────

variable "api_cpu" {
  description = "Fargate CPU units for the API task (256 = 0.25 vCPU)."
  type        = number
  default     = 256
}

variable "api_memory_mb" {
  description = "Fargate memory (MB) for the API task."
  type        = number
  default     = 512
}

variable "web_cpu" {
  description = "Fargate CPU units for the Web task."
  type        = number
  default     = 256
}

variable "web_memory_mb" {
  description = "Fargate memory (MB) for the Web task."
  type        = number
  default     = 512
}

variable "api_desired_count" {
  description = "Desired number of API ECS tasks."
  type        = number
  default     = 1
}

variable "web_desired_count" {
  description = "Desired number of Web ECS tasks."
  type        = number
  default     = 1
}

# ─── Application ──────────────────────────────────────────────────────────────

variable "api_port" {
  description = "Port exposed by the API container."
  type        = number
  default     = 3000
}

variable "web_port" {
  description = "Port exposed by the Web container."
  type        = number
  default     = 3001
}

variable "jwt_access_ttl" {
  description = "JWT access token TTL (e.g. '15m')."
  type        = string
  default     = "15m"
}

variable "jwt_refresh_ttl" {
  description = "JWT refresh token TTL (e.g. '30d')."
  type        = string
  default     = "30d"
}

variable "otp_ttl_seconds" {
  description = "OTP validity window in seconds."
  type        = number
  default     = 300
}

variable "otp_max_attempts" {
  description = "Maximum OTP verification attempts."
  type        = number
  default     = 5
}

variable "otp_resend_cooldown_seconds" {
  description = "Seconds before a new OTP can be requested."
  type        = number
  default     = 60
}

variable "api_rate_limit" {
  description = "Max requests per rate-limit window per IP."
  type        = number
  default     = 120
}

variable "api_rate_ttl_ms" {
  description = "Rate-limit window in milliseconds."
  type        = number
  default     = 60000
}

variable "iot_offline_threshold_seconds" {
  description = "Seconds without heartbeat before a device is marked offline."
  type        = number
  default     = 60
}

variable "sms_provider" {
  description = "SMS adapter name. 'console' logs OTP to stdout and accepts 123456 (staging only). Production must use a real provider."
  type        = string
  default     = "console"
}

variable "kyc_provider" {
  description = "KYC adapter name (sandbox | <real-vendor>). Production must not use 'sandbox'."
  type        = string
  default     = "sandbox"
}

# ─── GitHub OIDC ──────────────────────────────────────────────────────────────

variable "enable_cloudfront" {
  description = "Set true once AWS verifies your account for CloudFront (contact AWS Support). Keep false for new accounts."
  type        = bool
  default     = false
}

variable "github_org" {
  description = "GitHub organisation or username that owns the repository."
  type        = string
  default     = "evseye-amit"
}

variable "github_repo" {
  description = "GitHub repository name (without the org prefix)."
  type        = string
  default     = "evseye"
}
