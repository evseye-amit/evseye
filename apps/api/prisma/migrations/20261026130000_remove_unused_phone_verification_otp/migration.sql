-- PHONE_VERIFICATION has no active caller. Remove its stale OTP rows before rebuilding the enum.
DELETE FROM "OtpRequest" WHERE "purpose"::text = 'PHONE_VERIFICATION';

CREATE TYPE "OtpPurpose_consolidated" AS ENUM (
  'LOGIN',
  'DEALLOCATION_RIDER',
  'DEALLOCATION_OPERATOR',
  'RETURN_PENALTY_APPROVAL',
  'VEHICLE_SUBMISSION_RIDER',
  'VEHICLE_SUBMISSION_TEAM_LEAD'
);

ALTER TABLE "OtpRequest"
  ALTER COLUMN "purpose" TYPE "OtpPurpose_consolidated"
  USING ("purpose"::text)::"OtpPurpose_consolidated";

DROP TYPE "OtpPurpose";
ALTER TYPE "OtpPurpose_consolidated" RENAME TO "OtpPurpose";
