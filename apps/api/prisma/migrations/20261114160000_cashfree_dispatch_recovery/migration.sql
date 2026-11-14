-- Existing reservations predate dispatch tracking: never treat them as proven unsent.
UPDATE "PaymentTransaction" SET "providerDebitClaimedAt" = "createdAt"
WHERE provider = 'CASHFREE' AND status = 'CREATING' AND "providerDebitClaimedAt" IS NULL;
