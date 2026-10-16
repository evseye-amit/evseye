ALTER TABLE "RewardRule" ADD COLUMN "expiryAt" TIMESTAMP(3);
ALTER TABLE "RewardRule" ADD CONSTRAINT "RewardRule_expiry_choice_check" CHECK ("expiryAt" IS NULL OR "expiryDays" IS NULL);
