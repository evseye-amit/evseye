-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OtpPurpose" ADD VALUE 'VEHICLE_SUBMISSION_RIDER';
ALTER TYPE "OtpPurpose" ADD VALUE 'VEHICLE_SUBMISSION_TEAM_LEAD';

-- AlterTable
ALTER TABLE "RentalTerminationRequest" ADD COLUMN     "submissionRequired" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "VehicleExchangeRequest" ADD COLUMN     "plannedHubId" TEXT,
ADD COLUMN     "plannedReturnDate" TIMESTAMP(3),
ADD COLUMN     "submissionRequired" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "VehicleSubmission" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "returnRequestId" TEXT,
    "exchangeRequestId" TEXT,
    "riderId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'IN_PROGRESS',
    "assetSnapshot" JSONB NOT NULL,
    "requiredPhotoTypes" TEXT[],
    "mechanicChecksComplete" BOOLEAN NOT NULL DEFAULT false,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleSubmissionReport" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "requestKey" VARCHAR(120) NOT NULL,
    "stage" VARCHAR(10) NOT NULL,
    "mechanicName" VARCHAR(150) NOT NULL,
    "summary" VARCHAR(4000) NOT NULL,
    "safeForReuse" BOOLEAN NOT NULL,
    "unsafeReason" VARCHAR(500),
    "checksComplete" BOOLEAN NOT NULL DEFAULT false,
    "evidencePhotoIds" TEXT[],
    "items" JSONB NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "digest" CHAR(64) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "recordedById" TEXT NOT NULL,
    "imposedById" TEXT,
    "imposedAt" TIMESTAMP(3),
    "riderOtpRequestId" TEXT,
    "riderVerifiedUserId" TEXT,
    "teamLeadOtpRequestId" TEXT,
    "teamLeadVerifiedUserId" TEXT,
    "riderBypassReason" VARCHAR(500),
    "teamLeadBypassReason" VARCHAR(500),
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "postedChargeId" TEXT,
    "cancelledById" TEXT,
    "cancellationReason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleSubmissionReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VehicleSubmission_allocationId_key" ON "VehicleSubmission"("allocationId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleSubmission_inspectionId_key" ON "VehicleSubmission"("inspectionId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleSubmission_returnRequestId_key" ON "VehicleSubmission"("returnRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleSubmission_exchangeRequestId_key" ON "VehicleSubmission"("exchangeRequestId");

-- CreateIndex
CREATE INDEX "VehicleSubmission_clientId_riderId_createdAt_idx" ON "VehicleSubmission"("clientId", "riderId", "createdAt");

-- CreateIndex
CREATE INDEX "VehicleSubmission_clientId_hubId_status_idx" ON "VehicleSubmission"("clientId", "hubId", "status");

-- CreateIndex
CREATE INDEX "VehicleSubmission_clientId_agreementId_idx" ON "VehicleSubmission"("clientId", "agreementId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleSubmissionReport_postedChargeId_key" ON "VehicleSubmissionReport"("postedChargeId");

-- CreateIndex
CREATE INDEX "VehicleSubmissionReport_clientId_submissionId_createdAt_idx" ON "VehicleSubmissionReport"("clientId", "submissionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleSubmissionReport_clientId_submissionId_requestKey_key" ON "VehicleSubmissionReport"("clientId", "submissionId", "requestKey");

-- AddForeignKey
ALTER TABLE "VehicleSubmission" ADD CONSTRAINT "VehicleSubmission_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSubmission" ADD CONSTRAINT "VehicleSubmission_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "Allocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSubmission" ADD CONSTRAINT "VehicleSubmission_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSubmission" ADD CONSTRAINT "VehicleSubmission_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "RentalTerminationRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSubmission" ADD CONSTRAINT "VehicleSubmission_exchangeRequestId_fkey" FOREIGN KEY ("exchangeRequestId") REFERENCES "VehicleExchangeRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSubmissionReport" ADD CONSTRAINT "VehicleSubmissionReport_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "VehicleSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Keep historical requests on their original workflow; all new requests use the
-- proof-backed dual-confirmation workflow.
ALTER TABLE "RentalTerminationRequest" ALTER COLUMN "submissionRequired" SET DEFAULT true;
ALTER TABLE "VehicleExchangeRequest" ALTER COLUMN "submissionRequired" SET DEFAULT true;

ALTER TABLE "VehicleSubmission" ADD CONSTRAINT "VehicleSubmission_source_check"
  CHECK (("returnRequestId" IS NOT NULL)::int + ("exchangeRequestId" IS NOT NULL)::int = 1);
ALTER TABLE "VehicleSubmission" ADD CONSTRAINT "VehicleSubmission_status_check"
  CHECK (status IN ('IN_PROGRESS','CONFIRMED'));
ALTER TABLE "VehicleSubmissionReport" ADD CONSTRAINT "VehicleSubmissionReport_content_check"
  CHECK (stage IN ('BASIC','DEEP') AND status IN ('DRAFT','SUBMITTED','POSTED','CANCELLED')
    AND btrim("mechanicName") <> '' AND btrim(summary) <> '' AND cardinality("evidencePhotoIds") > 0
    AND jsonb_typeof(items) = 'array' AND "totalAmount" >= 0
    AND ("safeForReuse" OR ("unsafeReason" IS NOT NULL AND btrim("unsafeReason") <> ''))
    AND ("riderBypassReason" IS NULL OR btrim("riderBypassReason") <> '')
    AND ("teamLeadBypassReason" IS NULL OR btrim("teamLeadBypassReason") <> '')
    AND (status <> 'POSTED' OR ("confirmedAt" IS NOT NULL AND "confirmedById" IS NOT NULL
      AND ("riderOtpRequestId" IS NOT NULL OR "riderBypassReason" IS NOT NULL)
      AND ("teamLeadOtpRequestId" IS NOT NULL OR "teamLeadBypassReason" IS NOT NULL)
      AND ("totalAmount" = 0 OR "postedChargeId" IS NOT NULL))));
CREATE UNIQUE INDEX "one_pending_vehicle_submission_report" ON "VehicleSubmissionReport" ("submissionId") WHERE status IN ('DRAFT','SUBMITTED');
CREATE UNIQUE INDEX "one_posted_basic_vehicle_report" ON "VehicleSubmissionReport" ("submissionId") WHERE stage = 'BASIC' AND status = 'POSTED';
ALTER TABLE "VehicleSubmissionReport" ADD CONSTRAINT "VehicleSubmissionReport_postedChargeId_fkey" FOREIGN KEY ("postedChargeId") REFERENCES "RiderCharge"(id) ON DELETE RESTRICT;

CREATE FUNCTION guard_vehicle_submission_report() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status','imposedById','imposedAt','riderOtpRequestId','riderVerifiedUserId','teamLeadOtpRequestId','teamLeadVerifiedUserId','riderBypassReason','teamLeadBypassReason','confirmedById','confirmedAt','postedChargeId','cancelledById','cancellationReason'])
    IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['status','imposedById','imposedAt','riderOtpRequestId','riderVerifiedUserId','teamLeadOtpRequestId','teamLeadVerifiedUserId','riderBypassReason','teamLeadBypassReason','confirmedById','confirmedAt','postedChargeId','cancelledById','cancellationReason']) THEN
    RAISE EXCEPTION 'Mechanic report content is immutable; cancel and create a new report' USING ERRCODE = '23514';
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
    IF NEW."riderBypassReason" IS NULL AND NOT EXISTS (SELECT 1 FROM "OtpRequest" o WHERE o.id = NEW."riderOtpRequestId" AND o."clientId" = NEW."clientId" AND o.status = 'VERIFIED' AND o.purpose::text = 'VEHICLE_SUBMISSION_RIDER' AND o.context->>'reportId' = NEW.id AND o.context->>'digest' = NEW.digest AND o.context->>'recipientId' = NEW."riderVerifiedUserId") THEN
      RAISE EXCEPTION 'Rider confirmation must match this report' USING ERRCODE = '23514';
    END IF;
    IF NEW."teamLeadBypassReason" IS NULL AND NOT EXISTS (SELECT 1 FROM "OtpRequest" o WHERE o.id = NEW."teamLeadOtpRequestId" AND o."clientId" = NEW."clientId" AND o.status = 'VERIFIED' AND o.purpose::text = 'VEHICLE_SUBMISSION_TEAM_LEAD' AND o.context->>'reportId' = NEW.id AND o.context->>'digest' = NEW.digest AND o.context->>'recipientId' = NEW."teamLeadVerifiedUserId") THEN
      RAISE EXCEPTION 'Team lead confirmation must match this report' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vehicle_submission_report_guard BEFORE UPDATE ON "VehicleSubmissionReport" FOR EACH ROW EXECUTE FUNCTION guard_vehicle_submission_report();

CREATE FUNCTION guard_vehicle_mechanic_reuse() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."allocationEnabled" OR NEW.status IN ('AVAILABLE','ALLOCATED','IN_USE')) AND EXISTS (
    SELECT 1 FROM "VehicleSubmission" s WHERE s."clientId" = NEW."clientId" AND s."fleetId" = NEW.id AND NOT s."mechanicChecksComplete"
  ) THEN RAISE EXCEPTION 'Vehicle mechanic checks are pending' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vehicle_mechanic_reuse_guard BEFORE UPDATE OF status, "allocationEnabled" ON "Fleet" FOR EACH ROW EXECUTE FUNCTION guard_vehicle_mechanic_reuse();

CREATE FUNCTION guard_vehicle_submission_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('INITIATED','INSPECTION_PENDING','OTP_PENDING','ACTIVE') AND EXISTS (
    SELECT 1 FROM "VehicleSubmission" s WHERE s."clientId" = NEW."clientId" AND s."fleetId" = NEW."fleetId" AND s."allocationId" <> NEW.id AND NOT s."mechanicChecksComplete"
  ) THEN RAISE EXCEPTION 'Vehicle mechanic checks are pending' USING ERRCODE = '23514'; END IF;
  IF NEW.status = 'COMPLETED' AND (
    EXISTS (SELECT 1 FROM "RentalTerminationRequest" r WHERE r."clientId" = NEW."clientId" AND r."allocationId" = NEW.id AND r."submissionRequired" AND r.status <> 'CANCELLED') OR
    EXISTS (SELECT 1 FROM "VehicleExchangeRequest" e WHERE e."clientId" = NEW."clientId" AND e."oldAllocationId" = NEW.id AND e."submissionRequired" AND e.status NOT IN ('CANCELLED','REJECTED'))
  ) AND NOT EXISTS (SELECT 1 FROM "VehicleSubmission" s WHERE s."clientId" = NEW."clientId" AND s."allocationId" = NEW.id AND s.status = 'CONFIRMED') THEN
    RAISE EXCEPTION 'Vehicle submission confirmation is required' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vehicle_submission_allocation_guard BEFORE INSERT OR UPDATE OF status ON "Allocation" FOR EACH ROW EXECUTE FUNCTION guard_vehicle_submission_allocation();
