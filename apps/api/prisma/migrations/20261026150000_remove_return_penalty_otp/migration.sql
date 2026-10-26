-- Penalty submission now goes directly to manager approval; rider OTP approval
-- and its admin override are no longer part of the backend workflow.
DELETE FROM "OtpRequest"
WHERE "purpose"::text = 'RETURN_PENALTY_APPROVAL';

UPDATE "ReturnPenaltyCase"
SET "status" = 'MANAGER_APPROVAL_PENDING'
WHERE "status" = 'RIDER_APPROVAL_PENDING';

ALTER TABLE "ReturnPenaltyCase"
  DROP COLUMN "riderApprovedRevision",
  DROP COLUMN "riderApprovedAt",
  DROP COLUMN "riderApprovalOtpRequestId",
  DROP COLUMN "adminOverrideRevision",
  DROP COLUMN "adminOverrideAt",
  DROP COLUMN "adminOverrideById",
  DROP COLUMN "adminOverrideReason";

CREATE TYPE "OtpPurpose_reduced" AS ENUM (
  'LOGIN',
  'HANDOVER_RIDER',
  'HANDOVER_OPERATOR'
);

ALTER TABLE "OtpRequest"
  ALTER COLUMN "purpose" TYPE "OtpPurpose_reduced"
  USING ("purpose"::text)::"OtpPurpose_reduced";

DROP TYPE "OtpPurpose";
ALTER TYPE "OtpPurpose_reduced" RENAME TO "OtpPurpose";
