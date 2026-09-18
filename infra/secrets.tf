# ─── Secrets Manager ──────────────────────────────────────────────────────────
# All application secrets are stored here and injected into ECS tasks at runtime.
# Terraform generates random values for cryptographic secrets.
# The DB password comes from rds.tf (random_password.db).

resource "random_password" "jwt_access" {
  length  = 64
  special = false
}

resource "random_password" "jwt_refresh" {
  length  = 64
  special = false
}

resource "random_password" "otp_hash" {
  length  = 64
  special = false
}

resource "random_password" "client_proxy" {
  length  = 64
  special = false
}

# ─── Individual secrets ───────────────────────────────────────────────────────

resource "aws_secretsmanager_secret" "db_password" {
  name                    = "${local.name_prefix}/db-password"
  recovery_window_in_days = 7
  tags                    = { Name = "${local.name_prefix}/db-password" }
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id     = aws_secretsmanager_secret.db_password.id
  secret_string = random_password.db.result
}

# Full DATABASE_URL connection string for the API container
resource "aws_secretsmanager_secret" "database_url" {
  name                    = "${local.name_prefix}/database-url"
  recovery_window_in_days = 7
  tags                    = { Name = "${local.name_prefix}/database-url" }
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = "postgresql://evseye:${urlencode(random_password.db.result)}@${aws_db_instance.main.endpoint}/evseye?schema=public&sslmode=require"

  depends_on = [aws_db_instance.main]
}

resource "aws_secretsmanager_secret" "jwt_access" {
  name                    = "${local.name_prefix}/jwt-access-secret"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "jwt_access" {
  secret_id     = aws_secretsmanager_secret.jwt_access.id
  secret_string = random_password.jwt_access.result
}

resource "aws_secretsmanager_secret" "jwt_refresh" {
  name                    = "${local.name_prefix}/jwt-refresh-secret"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "jwt_refresh" {
  secret_id     = aws_secretsmanager_secret.jwt_refresh.id
  secret_string = random_password.jwt_refresh.result
}

resource "aws_secretsmanager_secret" "otp_hash" {
  name                    = "${local.name_prefix}/otp-hash-secret"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "otp_hash" {
  secret_id     = aws_secretsmanager_secret.otp_hash.id
  secret_string = random_password.otp_hash.result
}

resource "aws_secretsmanager_secret" "client_proxy" {
  name                    = "${local.name_prefix}/client-proxy-secret"
  recovery_window_in_days = 7
  tags                    = { Name = "${local.name_prefix}/client-proxy-secret" }
}

resource "aws_secretsmanager_secret_version" "client_proxy" {
  secret_id     = aws_secretsmanager_secret.client_proxy.id
  secret_string = random_password.client_proxy.result
}
