-- Handover OTPs use the same purpose per recipient in deallocation and submission.
-- Their distinct context payloads continue to bind a code to its exact workflow.
CREATE TYPE "OtpPurpose_handover" AS ENUM (
  'LOGIN',
  'HANDOVER_RIDER',
  'HANDOVER_OPERATOR',
  'RETURN_PENALTY_APPROVAL'
);

ALTER TABLE "OtpRequest"
  ALTER COLUMN "purpose" TYPE "OtpPurpose_handover"
  USING (
    CASE "purpose"::text
      WHEN 'DEALLOCATION_RIDER' THEN 'HANDOVER_RIDER'
      WHEN 'VEHICLE_SUBMISSION_RIDER' THEN 'HANDOVER_RIDER'
      WHEN 'DEALLOCATION_OPERATOR' THEN 'HANDOVER_OPERATOR'
      WHEN 'VEHICLE_SUBMISSION_TEAM_LEAD' THEN 'HANDOVER_OPERATOR'
      ELSE "purpose"::text
    END
  )::"OtpPurpose_handover";

DROP TYPE "OtpPurpose";
ALTER TYPE "OtpPurpose_handover" RENAME TO "OtpPurpose";

-- Keep the database's final submission guard aligned with the shared purposes.
CREATE OR REPLACE FUNCTION guard_vehicle_submission_report() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.id IS DISTINCT FROM NEW.id OR OLD."clientId" IS DISTINCT FROM NEW."clientId" OR OLD."submissionId" IS DISTINCT FROM NEW."submissionId" OR OLD."requestKey" IS DISTINCT FROM NEW."requestKey" OR OLD.stage IS DISTINCT FROM NEW.stage OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt" OR OLD."recordedById" IS DISTINCT FROM NEW."recordedById" THEN RAISE EXCEPTION 'Report identity is immutable.'; END IF;
  IF OLD."postedChargeId" IS NOT NULL AND NEW.status='CANCELLED' THEN RAISE EXCEPTION 'An imposed financial charge cannot be cancelled.'; END IF;
  IF OLD.status<>'DRAFT' OR NEW.status<>'DRAFT' THEN
  IF (to_jsonb(NEW) - ARRAY['status','imposedById','imposedAt','riderOtpRequestId','riderVerifiedUserId','teamLeadOtpRequestId','teamLeadVerifiedUserId','riderBypassReason','teamLeadBypassReason','confirmedById','confirmedAt','postedChargeId','cancelledById','cancellationReason'])
    IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['status','imposedById','imposedAt','riderOtpRequestId','riderVerifiedUserId','teamLeadOtpRequestId','teamLeadVerifiedUserId','riderBypassReason','teamLeadBypassReason','confirmedById','confirmedAt','postedChargeId','cancelledById','cancellationReason']) THEN
    RAISE EXCEPTION 'Mechanic report content is immutable; cancel and create a new report' USING ERRCODE = '23514';
  END IF;
  END IF;
  IF OLD.status IN ('POSTED','CANCELLED') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Completed mechanic reports are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'POSTED' AND OLD.status <> 'POSTED' THEN
    IF NEW."riderBypassReason" IS NOT NULL OR NEW."teamLeadBypassReason" IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = NEW."confirmedById" AND u."clientId" = NEW."clientId" AND u.role = 'FLEET_MANAGER' AND u."isActive" AND u."deletedAt" IS NULL) THEN
        RAISE EXCEPTION 'Only the fleet manager may bypass confirmation' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NEW."riderBypassReason" IS NULL AND NOT EXISTS (SELECT 1 FROM "OtpRequest" o WHERE o.id = NEW."riderOtpRequestId" AND o."clientId" = NEW."clientId" AND o.status = 'VERIFIED' AND o.purpose::text = 'HANDOVER_RIDER' AND o.context->>'reportId' = NEW.id AND o.context->>'digest' = NEW.digest AND o.context->>'recipientId' = NEW."riderVerifiedUserId") THEN
      RAISE EXCEPTION 'Rider confirmation must match this report' USING ERRCODE = '23514';
    END IF;
    IF NEW."teamLeadBypassReason" IS NULL AND NOT EXISTS (SELECT 1 FROM "OtpRequest" o WHERE o.id = NEW."teamLeadOtpRequestId" AND o."clientId" = NEW."clientId" AND o.status = 'VERIFIED' AND o.purpose::text = 'HANDOVER_OPERATOR' AND o.context->>'reportId' = NEW.id AND o.context->>'digest' = NEW.digest AND o.context->>'recipientId' = NEW."teamLeadVerifiedUserId") THEN
      RAISE EXCEPTION 'Team lead confirmation must match this report' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
