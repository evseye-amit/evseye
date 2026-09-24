resource "aws_route53_zone" "main" {
  name = var.root_domain
  tags = { Name = "${local.name_prefix}-zone" }
}

# staging.evseye.com → ALB
resource "aws_route53_record" "web" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "${var.web_subdomain}.${var.root_domain}"
  type    = "A"
  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

# <client>.staging.evseye.com → ALB (production clients use *.evseye.com)
resource "aws_route53_record" "client_subdomains" {
  zone_id = aws_route53_zone.main.zone_id
  name    = var.environment == "staging" ? "*.${var.web_subdomain}.${var.root_domain}" : "*.${var.root_domain}"
  type    = "A"
  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

# api.staging.evseye.com → ALB
resource "aws_route53_record" "api" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "${var.api_subdomain}.${var.root_domain}"
  type    = "A"
  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

# media.staging.evseye.com → CloudFront (only when CloudFront enabled)
resource "aws_route53_record" "media" {
  count   = var.enable_cloudfront ? 1 : 0
  zone_id = aws_route53_zone.main.zone_id
  name    = "${var.media_subdomain}.${var.root_domain}"
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.media[0].domain_name
    zone_id                = aws_cloudfront_distribution.media[0].hosted_zone_id
    evaluate_target_health = false
  }
}
