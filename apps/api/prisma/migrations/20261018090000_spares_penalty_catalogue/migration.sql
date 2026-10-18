-- AlterTable
ALTER TABLE "ReturnPenaltyPrice" ADD COLUMN     "baseRate" DECIMAL(14,2),
ADD COLUMN     "configurationVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "evidenceRequired" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "gstPercent" DECIMAL(5,2),
ADD COLUMN     "hsnCode" VARCHAR(20),
ADD COLUMN     "isSpare" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "masterSpareId" TEXT,
ADD COLUMN     "name" VARCHAR(180),
ADD COLUMN     "penaltyConfigured" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sourceVersion" INTEGER,
ADD COLUMN     "unit" VARCHAR(30) NOT NULL DEFAULT 'PIECE',
ADD COLUMN     "vehicleTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "SparePartMaster" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "baseRate" DECIMAL(14,2) NOT NULL,
    "gstPercent" DECIMAL(5,2) NOT NULL,
    "hsnCode" VARCHAR(20) NOT NULL,
    "unit" VARCHAR(30) NOT NULL DEFAULT 'PIECE',
    "vehicleTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SparePartMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpareCatalogueRevision" (
    "id" TEXT NOT NULL,
    "masterSpareId" TEXT,
    "priceId" TEXT,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpareCatalogueRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SparePartMaster_code_key" ON "SparePartMaster"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SpareCatalogueRevision_masterSpareId_version_key" ON "SpareCatalogueRevision"("masterSpareId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SpareCatalogueRevision_priceId_version_key" ON "SpareCatalogueRevision"("priceId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnPenaltyPrice_clientId_masterSpareId_key" ON "ReturnPenaltyPrice"("clientId", "masterSpareId");

-- AddForeignKey
ALTER TABLE "ReturnPenaltyPrice" ADD CONSTRAINT "ReturnPenaltyPrice_masterSpareId_fkey" FOREIGN KEY ("masterSpareId") REFERENCES "SparePartMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpareCatalogueRevision" ADD CONSTRAINT "SpareCatalogueRevision_masterSpareId_fkey" FOREIGN KEY ("masterSpareId") REFERENCES "SparePartMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpareCatalogueRevision" ADD CONSTRAINT "SpareCatalogueRevision_priceId_fkey" FOREIGN KEY ("priceId") REFERENCES "ReturnPenaltyPrice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "SparePartMaster" ADD CONSTRAINT spare_master_values CHECK ("baseRate">=0 AND "gstPercent" BETWEEN 0 AND 100 AND version>0);
ALTER TABLE "ReturnPenaltyPrice" ADD CONSTRAINT spare_penalty_values CHECK ("configurationVersion">0 AND (NOT "isSpare" OR (name IS NOT NULL AND "baseRate">=0 AND "gstPercent" BETWEEN 0 AND 100 AND "hsnCode" IS NOT NULL AND amount>=0 AND (NOT "isActive" OR "penaltyConfigured"))));
ALTER TABLE "SpareCatalogueRevision" ADD CONSTRAINT spare_revision_owner CHECK (("masterSpareId" IS NOT NULL)::int + ("priceId" IS NOT NULL)::int = 1);
CREATE FUNCTION freeze_spare_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Spare catalogue revisions are immutable.'; END $$;
CREATE TRIGGER freeze_spare_revision BEFORE UPDATE OR DELETE ON "SpareCatalogueRevision" FOR EACH ROW EXECUTE FUNCTION freeze_spare_revision();
CREATE FUNCTION spare_origin_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD."clientId" IS DISTINCT FROM NEW."clientId" OR OLD."masterSpareId" IS DISTINCT FROM NEW."masterSpareId" OR OLD."isSpare" IS DISTINCT FROM NEW."isSpare" OR OLD.code IS DISTINCT FROM NEW.code THEN RAISE EXCEPTION 'Spare ownership, origin and part code are immutable.'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER spare_origin_immutable BEFORE UPDATE ON "ReturnPenaltyPrice" FOR EACH ROW EXECUTE FUNCTION spare_origin_immutable();

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
    IF NEW."riderBypassReason" IS NULL AND NOT EXISTS (SELECT 1 FROM "OtpRequest" o WHERE o.id = NEW."riderOtpRequestId" AND o."clientId" = NEW."clientId" AND o.status = 'VERIFIED' AND o.purpose::text = 'VEHICLE_SUBMISSION_RIDER' AND o.context->>'reportId' = NEW.id AND o.context->>'digest' = NEW.digest AND o.context->>'recipientId' = NEW."riderVerifiedUserId") THEN
      RAISE EXCEPTION 'Rider confirmation must match this report' USING ERRCODE = '23514';
    END IF;
    IF NEW."teamLeadBypassReason" IS NULL AND NOT EXISTS (SELECT 1 FROM "OtpRequest" o WHERE o.id = NEW."teamLeadOtpRequestId" AND o."clientId" = NEW."clientId" AND o.status = 'VERIFIED' AND o.purpose::text = 'VEHICLE_SUBMISSION_TEAM_LEAD' AND o.context->>'reportId' = NEW.id AND o.context->>'digest' = NEW.digest AND o.context->>'recipientId' = NEW."teamLeadVerifiedUserId") THEN
      RAISE EXCEPTION 'Team lead confirmation must match this report' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Newly copied spares can be unconfigured; legacy operational prices remain positive.
ALTER TABLE "ReturnPenaltyPrice" DROP CONSTRAINT "ReturnPenaltyPrice_amount_check";
ALTER TABLE "ReturnPenaltyPrice" ADD CONSTRAINT "ReturnPenaltyPrice_amount_check" CHECK (amount>0 OR ("isSpare" AND amount=0 AND NOT "penaltyConfigured" AND NOT "isActive"));
