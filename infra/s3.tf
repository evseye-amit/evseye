# ─── S3 Bucket (private media storage) ───────────────────────────────────────

resource "aws_s3_bucket" "media" {
  bucket = "${local.name_prefix}-media"
  tags   = { Name = "${local.name_prefix}-media" }
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"
    filter {} # empty = apply to all objects
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }
}

# ─── CloudFront Origin Access Control (only when CloudFront enabled) ──────────

resource "aws_cloudfront_origin_access_control" "media" {
  count                             = var.enable_cloudfront ? 1 : 0
  name                              = "${local.name_prefix}-media-oac"
  description                       = "OAC for evseye media bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ─── Bucket policy ────────────────────────────────────────────────────────────
# When CloudFront is enabled: allow CloudFront + ECS task role.
# When CloudFront is disabled: allow ECS task role only (staging mode).

resource "aws_s3_bucket_policy" "media_with_cloudfront" {
  count  = var.enable_cloudfront ? 1 : 0
  bucket = aws_s3_bucket.media.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontServicePrincipal"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.media.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.media[0].arn
          }
        }
      },
      {
        Sid       = "AllowECSTaskPut"
        Effect    = "Allow"
        Principal = { AWS = aws_iam_role.ecs_task_api.arn }
        Action    = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:GetObjectAttributes"]
        Resource  = "${aws_s3_bucket.media.arn}/*"
      }
    ]
  })
}

resource "aws_s3_bucket_policy" "media_no_cloudfront" {
  count  = var.enable_cloudfront ? 0 : 1
  bucket = aws_s3_bucket.media.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowECSTaskAccess"
        Effect    = "Allow"
        Principal = { AWS = aws_iam_role.ecs_task_api.arn }
        Action    = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:GetObjectAttributes", "s3:ListBucket"]
        Resource  = ["${aws_s3_bucket.media.arn}", "${aws_s3_bucket.media.arn}/*"]
      }
    ]
  })
}
