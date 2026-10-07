# Release the old parent zone and its DNS records from the staging state without
# deleting them in Route 53. The old parent zone remains authoritative until the
# separate production parent-zone migration and GoDaddy nameserver cutover.
# Keep these blocks until the staging migration has been applied everywhere.
removed {
  from = aws_route53_zone.main
  lifecycle { destroy = false }
}

removed {
  from = aws_route53_record.web
  lifecycle { destroy = false }
}

removed {
  from = aws_route53_record.client_subdomains
  lifecycle { destroy = false }
}

removed {
  from = aws_route53_record.api
  lifecycle { destroy = false }
}

removed {
  from = aws_route53_record.media
  lifecycle { destroy = false }
}

removed {
  from = aws_route53_record.alb_cert_validation
  lifecycle { destroy = false }
}

removed {
  from = aws_route53_record.cloudfront_cert_validation
  lifecycle { destroy = false }
}
