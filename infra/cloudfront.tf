# CloudFront is gated behind enable_cloudfront because new AWS accounts
# must be verified by AWS Support before creating CloudFront distributions.
# Set enable_cloudfront = true in variables.tf once your account is verified.

resource "aws_cloudfront_distribution" "media" {
  count       = var.enable_cloudfront ? 1 : 0
  enabled     = true
  comment     = "${local.name_prefix} media CDN"
  aliases     = ["${var.media_subdomain}.${var.root_domain}"]
  price_class = "PriceClass_200"

  origin {
    domain_name              = aws_s3_bucket.media.bucket_regional_domain_name
    origin_id                = "s3-media"
    origin_access_control_id = aws_cloudfront_origin_access_control.media[0].id
  }

  default_cache_behavior {
    target_origin_id       = "s3-media"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 86400
    max_ttl     = 31536000
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    acm_certificate_arn      = one(aws_acm_certificate_validation.cloudfront[*].certificate_arn)
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags       = { Name = "${local.name_prefix}-media-cdn" }
  depends_on = [aws_acm_certificate_validation.cloudfront]
}
