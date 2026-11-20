# Wallet AutoPay handoff — superseded

Use [Unified AutoPay Flutter handoff](unified-autopay-flutter-handoff.md) for the current contract. The separate wallet preference and legacy mandate routes have been removed. They return 404; do not use fallback calls to them.

Manual Add Money, payment webhooks and historical payment reconciliation remain supported. AutoPay consent, setup and recharge history use the unified resource.
