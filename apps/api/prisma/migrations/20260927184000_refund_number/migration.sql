CREATE SEQUENCE IF NOT EXISTS "PaymentRefund_number_seq";
ALTER TABLE "PaymentRefund" ADD COLUMN "refundNumber" VARCHAR(50);
CREATE UNIQUE INDEX "PaymentRefund_refundNumber_key" ON "PaymentRefund"("refundNumber");
