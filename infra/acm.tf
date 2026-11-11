# ALB certificate — ap-south-1 (staging) or the selected application region.
# Staging certificates cover only the delegated staging zone, so renewal does
# not depend on the production account's evseye.com hosted zone.
resource "aws_acm_certificate" "alb" {
  domain_name = local.dns_zone_name
  subject_alternative_names = [
    "*.${local.dns_zone_name}",
    "${var.api_subdomain}.${var.root_domain}",
  ]
  validation_method = "DNS"
  lifecycle { create_before_destroy = true }
  tags = { Name = "${local.name_prefix}-alb-cert" }
}

resource "aws_route53_record" "application_alb_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.alb.domain_validation_options :
    dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
    # ACM uses one CNAME for the zone apex and its wildcard. Manage it once.
    if dvo.domain_name != local.dns_zone_name
  }

  zone_id         = data.aws_route53_zone.application.zone_id
  name            = each.value.name
  type            = each.value.type
  ttl             = 60
  records         = [trimsuffix(each.value.record, ".")]
  allow_overwrite = true # safe re-run if record was created by a previous partial apply
}

resource "aws_acm_certificate_validation" "alb" {
  certificate_arn         = aws_acm_certificate.alb.arn
  validation_record_fqdns = [for r in aws_route53_record.application_alb_cert_validation : r.fqdn]
}

# ─── CloudFront certificate — must be in us-east-1 ───────────────────────────
# Only created when enable_cloudfront = true.

resource "aws_acm_certificate" "cloudfront" {
  count    = var.enable_cloudfront ? 1 : 0
  provider = aws.us_east_1

  domain_name       = "${var.media_subdomain}.${var.root_domain}"
  validation_method = "DNS"
  lifecycle { create_before_destroy = true }
  tags = { Name = "${local.name_prefix}-cloudfront-cert" }
}

resource "aws_route53_record" "application_cloudfront_cert_validation" {
  for_each = var.enable_cloudfront ? {
    for dvo in aws_acm_certificate.cloudfront[0].domain_validation_options :
    dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  zone_id         = data.aws_route53_zone.application.zone_id
  name            = each.value.name
  type            = each.value.type
  ttl             = 60
  records         = [trimsuffix(each.value.record, ".")]
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "cloudfront" {
  count    = var.enable_cloudfront ? 1 : 0
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.cloudfront[0].arn
  validation_record_fqdns = [for r in aws_route53_record.application_cloudfront_cert_validation : r.fqdn]
}
