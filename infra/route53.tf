locals {
  dns_zone_name = var.environment == "staging" ? "${var.web_subdomain}.${var.root_domain}" : var.root_domain
}

# The hosted zone is created separately from the application stack. In staging,
# this is the delegated staging.evseye.com zone in account 591132358460.
data "aws_route53_zone" "application" {
  name         = "${local.dns_zone_name}."
  private_zone = false
}

# staging.evseye.com → ALB
resource "aws_route53_record" "application_web" {
  zone_id         = data.aws_route53_zone.application.zone_id
  allow_overwrite = true
  name            = "${var.web_subdomain}.${var.root_domain}"
  type            = "A"
  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

# <client>.staging.evseye.com → ALB (production clients use *.evseye.com)
resource "aws_route53_record" "application_client_subdomains" {
  zone_id         = data.aws_route53_zone.application.zone_id
  allow_overwrite = true
  name            = var.environment == "staging" ? "*.${var.web_subdomain}.${var.root_domain}" : "*.${var.root_domain}"
  type            = "A"
  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

# api.staging.evseye.com → ALB
resource "aws_route53_record" "application_api" {
  zone_id         = data.aws_route53_zone.application.zone_id
  allow_overwrite = true
  name            = "${var.api_subdomain}.${var.root_domain}"
  type            = "A"
  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

# media.staging.evseye.com → CloudFront (only when CloudFront enabled)
resource "aws_route53_record" "application_media" {
  count           = var.enable_cloudfront ? 1 : 0
  zone_id         = data.aws_route53_zone.application.zone_id
  allow_overwrite = true
  name            = "${var.media_subdomain}.${var.root_domain}"
  type            = "A"
  alias {
    name                   = aws_cloudfront_distribution.media[0].domain_name
    zone_id                = aws_cloudfront_distribution.media[0].hosted_zone_id
    evaluate_target_health = false
  }
}
