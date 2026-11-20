-- Historical captures remain unknown; never backfill UPI from a checkout label.
ALTER TABLE "DeploymentPaymentCapture" ADD COLUMN "paymentMethod" VARCHAR(30);
ALTER TABLE "RazorpayPenaltyCapture" ADD COLUMN "paymentMethod" VARCHAR(30);
