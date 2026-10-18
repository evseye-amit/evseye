-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'RFD_MANAGER';
ALTER TYPE "UserRole" ADD VALUE 'QC_MANAGER';

-- AlterEnum
ALTER TYPE "PhotoEntityType" ADD VALUE 'PREPARATION';

-- AlterEnum
ALTER TYPE "FleetOperatingMode" ADD VALUE 'PREPARATION_QC';

-- AlterTable
ALTER TABLE "Fleet" ADD COLUMN     "readinessApprovedPreparationId" TEXT,
ADD COLUMN "allocationBlockedByAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "FleetReadinessPolicy" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "configuration" JSONB NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FleetReadinessPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetReadinessStaff" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "canPrepare" BOOLEAN NOT NULL DEFAULT false,
    "canReview" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FleetReadinessStaff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetPreparation" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    "assignedToId" TEXT,
    "currentRevision" INTEGER NOT NULL DEFAULT 1,
    "policySnapshot" JSONB NOT NULL,
    "invalidationReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetPreparation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetPreparationRevision" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "checklist" JSONB NOT NULL DEFAULT '{}',
    "componentSnapshot" JSONB,
    "photoIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "decision" TEXT,
    "rejectionReason" TEXT,
    "failedItems" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FleetPreparationRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetPreparationEvent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FleetPreparationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FleetReadinessPolicy_clientId_version_key" ON "FleetReadinessPolicy"("clientId", "version");

-- CreateIndex
CREATE INDEX "FleetReadinessStaff_clientId_hubId_idx" ON "FleetReadinessStaff"("clientId", "hubId");

-- CreateIndex
CREATE UNIQUE INDEX "FleetReadinessStaff_clientId_userId_hubId_key" ON "FleetReadinessStaff"("clientId", "userId", "hubId");

-- CreateIndex
CREATE INDEX "FleetPreparation_clientId_hubId_status_idx" ON "FleetPreparation"("clientId", "hubId", "status");

-- CreateIndex
CREATE INDEX "FleetPreparation_clientId_fleetId_createdAt_idx" ON "FleetPreparation"("clientId", "fleetId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FleetPreparation_clientId_id_key" ON "FleetPreparation"("clientId", "id");

-- CreateIndex
CREATE INDEX "FleetPreparationRevision_clientId_preparationId_idx" ON "FleetPreparationRevision"("clientId", "preparationId");

-- CreateIndex
CREATE UNIQUE INDEX "FleetPreparationRevision_preparationId_revision_key" ON "FleetPreparationRevision"("preparationId", "revision");

-- CreateIndex
CREATE INDEX "FleetPreparationEvent_clientId_preparationId_createdAt_idx" ON "FleetPreparationEvent"("clientId", "preparationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Fleet_clientId_id_key" ON "Fleet"("clientId", "id");

-- AddForeignKey
ALTER TABLE "FleetPreparationRevision" ADD CONSTRAINT "FleetPreparationRevision_clientId_preparationId_fkey" FOREIGN KEY ("clientId", "preparationId") REFERENCES "FleetPreparation"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Tenant and lifecycle integrity. Existing clients keep their existing mode.
ALTER TABLE "FleetReadinessPolicy" ADD FOREIGN KEY ("clientId") REFERENCES "Client"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FleetReadinessStaff" ADD FOREIGN KEY ("clientId", "userId") REFERENCES "User"("clientId",id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FleetReadinessStaff" ADD FOREIGN KEY ("hubId") REFERENCES "Hub"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FleetPreparation" ADD FOREIGN KEY ("clientId","fleetId") REFERENCES "Fleet"("clientId",id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FleetPreparation" ADD FOREIGN KEY ("hubId") REFERENCES "Hub"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FleetPreparationEvent" ADD FOREIGN KEY ("clientId","preparationId") REFERENCES "FleetPreparation"("clientId",id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FleetPreparation" ADD CONSTRAINT preparation_status_check CHECK (status IN ('PENDING','IN_PROGRESS','AWAITING_QC','REWORK_REQUIRED','APPROVED','INVALIDATED','CANCELLED'));
CREATE UNIQUE INDEX preparation_one_open_cycle ON "FleetPreparation"("fleetId") WHERE status IN ('PENDING','IN_PROGRESS','AWAITING_QC','REWORK_REQUIRED');

CREATE FUNCTION invalidate_fleet_readiness(fleet_id TEXT, why TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "FleetPreparationEvent" (id,"clientId","preparationId",action,data,"createdAt")
    SELECT gen_random_uuid()::text,"clientId",id,'INVALIDATED',jsonb_build_object('reason',why),CURRENT_TIMESTAMP
    FROM "FleetPreparation" WHERE "fleetId"=fleet_id AND status NOT IN ('INVALIDATED','CANCELLED');
  UPDATE "FleetPreparation" SET status='INVALIDATED',"invalidationReason"=why,"updatedAt"=CURRENT_TIMESTAMP
    WHERE "fleetId"=fleet_id AND status NOT IN ('INVALIDATED','CANCELLED');
  UPDATE "Fleet" SET "readinessApprovedPreparationId"=NULL WHERE id=fleet_id AND "readinessApprovedPreparationId" IS NOT NULL;
END $$;

-- Every inventory mutation path, including imports, invalidates the approval.
CREATE FUNCTION readiness_component_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN PERFORM invalidate_fleet_readiness(OLD."fleetId",'Installed component changed.'); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM invalidate_fleet_readiness(NEW."fleetId",'Installed component changed.'); END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER readiness_battery_change AFTER INSERT OR UPDATE OR DELETE ON "FleetBatteryHistory" FOR EACH ROW EXECUTE FUNCTION readiness_component_changed();
CREATE TRIGGER readiness_controller_change AFTER INSERT OR UPDATE OR DELETE ON "FleetControllerHistory" FOR EACH ROW EXECUTE FUNCTION readiness_component_changed();

CREATE FUNCTION readiness_component_identity_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f TEXT;
BEGIN
  IF TG_TABLE_NAME='Battery' THEN
    FOR f IN SELECT "fleetId" FROM "FleetBatteryHistory" WHERE "batteryId"=NEW.id AND "removedAt" IS NULL LOOP PERFORM invalidate_fleet_readiness(f,'Battery identity changed.'); END LOOP;
  ELSIF TG_TABLE_NAME='Controller' THEN
    FOR f IN SELECT "fleetId" FROM "FleetControllerHistory" WHERE "controllerId"=NEW.id AND "removedAt" IS NULL LOOP PERFORM invalidate_fleet_readiness(f,'Controller identity changed.'); END LOOP;
  ELSE
    FOR f IN SELECT id FROM "Fleet" WHERE "iotDeviceId"=NEW.id LOOP PERFORM invalidate_fleet_readiness(f,'IoT identity changed.'); END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER readiness_battery_identity AFTER UPDATE OF "serialNumber" ON "Battery" FOR EACH ROW WHEN (OLD."serialNumber" IS DISTINCT FROM NEW."serialNumber") EXECUTE FUNCTION readiness_component_identity_changed();
CREATE TRIGGER readiness_controller_identity AFTER UPDATE OF "controllerNumber" ON "Controller" FOR EACH ROW WHEN (OLD."controllerNumber" IS DISTINCT FROM NEW."controllerNumber") EXECUTE FUNCTION readiness_component_identity_changed();
CREATE TRIGGER readiness_iot_identity AFTER UPDATE OF "deviceNumber" ON "IoTDevice" FOR EACH ROW WHEN (OLD."deviceNumber" IS DISTINCT FROM NEW."deviceNumber") EXECUTE FUNCTION readiness_component_identity_changed();

CREATE FUNCTION enforce_fleet_readiness() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prep_mode BOOLEAN; invalidated BOOLEAN := FALSE;
BEGIN
  SELECT "fleetOperatingMode"::text='PREPARATION_QC' INTO prep_mode FROM "Client" WHERE id=NEW."clientId";
  IF TG_OP='UPDATE' THEN
    invalidated := OLD."currentHubId" IS DISTINCT FROM NEW."currentHubId" OR OLD."iotDeviceId" IS DISTINCT FROM NEW."iotDeviceId"
      OR (NEW.status IN ('MAINTENANCE','OUT_OF_SERVICE') AND OLD.status IS DISTINCT FROM NEW.status)
      OR (OLD.status IN ('ALLOCATED','IN_USE','DEALLOCATION_IN_PROGRESS') AND NEW.status NOT IN ('ALLOCATED','IN_USE','DEALLOCATION_IN_PROGRESS'));
    IF invalidated THEN
      NEW."readinessApprovedPreparationId" := NULL;
      INSERT INTO "FleetPreparationEvent" (id,"clientId","preparationId",action,data,"createdAt")
        SELECT gen_random_uuid()::text,"clientId",id,'INVALIDATED','{"reason":"Hub, component, maintenance or return changed readiness."}'::jsonb,CURRENT_TIMESTAMP
        FROM "FleetPreparation" WHERE "fleetId"=NEW.id AND status NOT IN ('INVALIDATED','CANCELLED');
      UPDATE "FleetPreparation" SET status='INVALIDATED',"invalidationReason"='Hub, component, maintenance or return changed readiness.',"updatedAt"=CURRENT_TIMESTAMP
        WHERE "fleetId"=NEW.id AND status NOT IN ('INVALIDATED','CANCELLED');
    END IF;
  END IF;
  IF NEW."readinessApprovedPreparationId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "FleetPreparation" p WHERE p.id=NEW."readinessApprovedPreparationId" AND p."clientId"=NEW."clientId" AND p."fleetId"=NEW.id AND p."hubId"=NEW."currentHubId" AND p.status='APPROVED'
  ) THEN NEW."readinessApprovedPreparationId" := NULL; END IF;
  IF prep_mode AND NEW."allocationBlockedByAdmin" THEN NEW."allocationEnabled":=false; END IF;
  IF prep_mode AND NEW.status='AVAILABLE' AND NEW."readinessApprovedPreparationId" IS NULL THEN NEW.status:='INSPECTION_PENDING'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER enforce_fleet_readiness BEFORE INSERT OR UPDATE ON "Fleet" FOR EACH ROW EXECUTE FUNCTION enforce_fleet_readiness();

-- A return/submission never reuses the approval from the previous handover.
CREATE FUNCTION readiness_submission_received() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM invalidate_fleet_readiness(NEW."fleetId",'Vehicle received for submission.');
  RETURN NEW;
END $$;
CREATE TRIGGER readiness_submission_received AFTER INSERT ON "VehicleSubmission" FOR EACH ROW EXECUTE FUNCTION readiness_submission_received();

-- Guard all allocation entry points and final handovers, including exchange paths.
CREATE FUNCTION enforce_allocation_readiness() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prep_mode BOOLEAN; approved TEXT; disabled BOOLEAN;
BEGIN
  IF TG_OP='UPDATE' AND NOT (NEW.status='ACTIVE' AND OLD.status IS DISTINCT FROM NEW.status) THEN RETURN NEW; END IF;
  IF NEW.status IN ('COMPLETED','CANCELLED') THEN RETURN NEW; END IF;
  SELECT "fleetOperatingMode"::text='PREPARATION_QC' INTO prep_mode FROM "Client" WHERE id=NEW."clientId" FOR SHARE;
  IF prep_mode THEN
    SELECT "readinessApprovedPreparationId", (NOT "allocationEnabled" OR "allocationBlockedByAdmin") INTO approved, disabled FROM "Fleet" WHERE id=NEW."fleetId" AND "clientId"=NEW."clientId" FOR UPDATE;
    IF disabled THEN RAISE EXCEPTION 'FLEET_ALLOCATION_BLOCKED: Allocation is administratively disabled.' USING ERRCODE='P0001'; END IF;
    IF approved IS NULL THEN RAISE EXCEPTION 'PREPARATION_QC_REQUIRED: Scooter requires current preparation and QC approval.' USING ERRCODE='P0001'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER enforce_allocation_readiness BEFORE INSERT OR UPDATE OF status ON "Allocation" FOR EACH ROW EXECUTE FUNCTION enforce_allocation_readiness();

-- Once submitted, evidence/checklist/component snapshots cannot be overwritten.
CREATE FUNCTION freeze_preparation_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."submittedAt" IS NOT NULL AND (
    NEW.checklist IS DISTINCT FROM OLD.checklist OR NEW."componentSnapshot" IS DISTINCT FROM OLD."componentSnapshot"
    OR NEW."photoIds" IS DISTINCT FROM OLD."photoIds" OR NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt"
    OR NEW."submittedById" IS DISTINCT FROM OLD."submittedById" OR NEW.revision IS DISTINCT FROM OLD.revision
  ) THEN RAISE EXCEPTION 'Submitted preparation evidence is immutable.'; END IF;
  IF OLD."reviewedAt" IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Reviewed preparation revision is immutable.'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER freeze_preparation_revision BEFORE UPDATE ON "FleetPreparationRevision" FOR EACH ROW EXECUTE FUNCTION freeze_preparation_revision();
CREATE FUNCTION freeze_preparation_photo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."entityType"::text='PREPARATION' AND EXISTS (SELECT 1 FROM "FleetPreparationRevision" r WHERE r.id=OLD."entityId" AND r."submittedAt" IS NOT NULL)
    THEN RAISE EXCEPTION 'Submitted preparation photos are immutable.'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER freeze_preparation_photo BEFORE UPDATE OR DELETE ON "Photo" FOR EACH ROW EXECUTE FUNCTION freeze_preparation_photo();
