-- AlterEnum
ALTER TYPE "FleetOperatingMode" ADD VALUE 'STAGED_PREPARATION_QC';

-- AlterTable
ALTER TABLE "FleetReadinessStaff" ADD COLUMN     "reviewStageCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "stageCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "FleetInstallationStage" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "assignedToId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "definition" JSONB NOT NULL,
    "checklist" JSONB NOT NULL DEFAULT '{}',
    "componentSnapshot" JSONB,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reason" TEXT,
    "failedItems" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "history" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetInstallationStage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FleetInstallationStage_clientId_status_idx" ON "FleetInstallationStage"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FleetInstallationStage_preparationId_code_key" ON "FleetInstallationStage"("preparationId", "code");

-- AddForeignKey
ALTER TABLE "FleetInstallationStage" ADD CONSTRAINT "FleetInstallationStage_clientId_preparationId_fkey" FOREIGN KEY ("clientId", "preparationId") REFERENCES "FleetPreparation"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION enforce_fleet_readiness() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prep_mode BOOLEAN; invalidated BOOLEAN := FALSE;
BEGIN
  SELECT "fleetOperatingMode"::text IN ('PREPARATION_QC','STAGED_PREPARATION_QC') INTO prep_mode FROM "Client" WHERE id=NEW."clientId";
  IF TG_OP='UPDATE' THEN
    invalidated := OLD."currentHubId" IS DISTINCT FROM NEW."currentHubId" OR OLD."iotDeviceId" IS DISTINCT FROM NEW."iotDeviceId"
      OR (NEW.status IN ('MAINTENANCE','OUT_OF_SERVICE') AND OLD.status IS DISTINCT FROM NEW.status)
      OR (OLD.status IN ('ALLOCATED','IN_USE','DEALLOCATION_IN_PROGRESS') AND NEW.status NOT IN ('ALLOCATED','IN_USE','DEALLOCATION_IN_PROGRESS'));
    IF OLD."iotDeviceId" IS DISTINCT FROM NEW."iotDeviceId" AND OLD."currentHubId" IS NOT DISTINCT FROM NEW."currentHubId" AND OLD.status IS NOT DISTINCT FROM NEW.status AND EXISTS (SELECT 1 FROM "FleetPreparation" p WHERE p."fleetId"=NEW.id AND p.status='IN_PROGRESS' AND p."policySnapshot"->>'operatingMode'='STAGED_PREPARATION_QC') THEN invalidated:=FALSE; END IF;
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

CREATE OR REPLACE FUNCTION enforce_allocation_readiness() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prep_mode BOOLEAN; approved TEXT; disabled BOOLEAN;
BEGIN
  IF TG_OP='UPDATE' AND NOT (NEW.status='ACTIVE' AND OLD.status IS DISTINCT FROM NEW.status) THEN RETURN NEW; END IF;
  IF NEW.status IN ('COMPLETED','CANCELLED') THEN RETURN NEW; END IF;
  SELECT "fleetOperatingMode"::text IN ('PREPARATION_QC','STAGED_PREPARATION_QC') INTO prep_mode FROM "Client" WHERE id=NEW."clientId" FOR SHARE;
  IF prep_mode THEN
    SELECT "readinessApprovedPreparationId", (NOT "allocationEnabled" OR "allocationBlockedByAdmin") INTO approved, disabled FROM "Fleet" WHERE id=NEW."fleetId" AND "clientId"=NEW."clientId" FOR UPDATE;
    IF disabled THEN RAISE EXCEPTION 'FLEET_ALLOCATION_BLOCKED: Allocation is administratively disabled.' USING ERRCODE='P0001'; END IF;
    IF approved IS NULL THEN RAISE EXCEPTION 'PREPARATION_QC_REQUIRED: Scooter requires current preparation and QC approval.' USING ERRCODE='P0001'; END IF;
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE "FleetInstallationStage" ADD CONSTRAINT installation_status CHECK (status IN ('WAITING','READY','IN_PROGRESS','SUBMITTED','COMPLETED','REWORK_REQUIRED'));
ALTER TABLE "FleetInstallationStage" ADD CONSTRAINT installation_revision CHECK (revision > 0);
-- A submitted revision is retained in append-only history, including photo ids.
CREATE FUNCTION freeze_installation_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."clientId" IS DISTINCT FROM OLD."clientId" OR NEW."preparationId" IS DISTINCT FROM OLD."preparationId" OR NEW.code IS DISTINCT FROM OLD.code OR NEW.definition IS DISTINCT FROM OLD.definition THEN RAISE EXCEPTION 'Installation identity and policy are immutable.'; END IF;
  IF jsonb_array_length(NEW.history)<jsonb_array_length(OLD.history) OR EXISTS (SELECT 1 FROM jsonb_array_elements(OLD.history) WITH ORDINALITY x(value,n) WHERE NEW.history->((x.n-1)::int) IS DISTINCT FROM x.value) THEN RAISE EXCEPTION 'Installation history is append only.'; END IF;
  IF OLD."submittedAt" IS NOT NULL AND NEW.revision=OLD.revision AND (NEW.checklist IS DISTINCT FROM OLD.checklist OR NEW."componentSnapshot" IS DISTINCT FROM OLD."componentSnapshot" OR NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt" OR NEW."submittedById" IS DISTINCT FROM OLD."submittedById") THEN RAISE EXCEPTION 'Submitted installation evidence is immutable.'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER freeze_installation_evidence BEFORE UPDATE ON "FleetInstallationStage" FOR EACH ROW EXECUTE FUNCTION freeze_installation_evidence();
CREATE OR REPLACE FUNCTION freeze_preparation_photo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."entityType"::text='PREPARATION' AND (
    EXISTS (SELECT 1 FROM "FleetPreparationRevision" r WHERE r.id=OLD."entityId" AND r."submittedAt" IS NOT NULL)
    OR EXISTS (SELECT 1 FROM "FleetInstallationStage" s WHERE OLD."entityId"='installation:'||s.id||':'||s.revision::text AND s."submittedAt" IS NOT NULL)
    OR EXISTS (SELECT 1 FROM "FleetInstallationStage" s, jsonb_array_elements(s.history) h WHERE h->'photoIds' ? OLD.id)
  ) THEN RAISE EXCEPTION 'Submitted preparation photos are immutable.'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
-- During installation, retain the cycle and reset only affected stages/dependents.
-- Final RFD submission or approved QC is invalidated by the existing guard.
CREATE OR REPLACE FUNCTION invalidate_fleet_readiness(fleet_id TEXT, why TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "FleetPreparationEvent" (id,"clientId","preparationId",action,data,"createdAt")
    SELECT gen_random_uuid()::text,"clientId",id,'INVALIDATED',jsonb_build_object('reason',why),CURRENT_TIMESTAMP
    FROM "FleetPreparation" WHERE "fleetId"=fleet_id AND status NOT IN ('INVALIDATED','CANCELLED')
    AND NOT (status IN ('PENDING','IN_PROGRESS','REWORK_REQUIRED') AND "policySnapshot"->>'operatingMode'='STAGED_PREPARATION_QC' AND why LIKE '%component%' OR status IN ('PENDING','IN_PROGRESS','REWORK_REQUIRED') AND "policySnapshot"->>'operatingMode'='STAGED_PREPARATION_QC' AND why LIKE '%identity%');
  UPDATE "FleetPreparation" SET status='INVALIDATED',"invalidationReason"=why,"updatedAt"=CURRENT_TIMESTAMP
    WHERE "fleetId"=fleet_id AND status NOT IN ('INVALIDATED','CANCELLED')
    AND NOT (status IN ('PENDING','IN_PROGRESS','REWORK_REQUIRED') AND "policySnapshot"->>'operatingMode'='STAGED_PREPARATION_QC' AND (why LIKE '%component%' OR why LIKE '%identity%'));
  UPDATE "Fleet" SET "readinessApprovedPreparationId"=NULL WHERE id=fleet_id AND "readinessApprovedPreparationId" IS NOT NULL;
END $$;
CREATE FUNCTION invalidate_installation_component(fleet_id TEXT, component_kind TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE stage_id TEXT; prep_id TEXT;
BEGIN
  FOR prep_id IN SELECT id FROM "FleetPreparation" WHERE "fleetId"=fleet_id AND status IN ('PENDING','IN_PROGRESS','REWORK_REQUIRED') AND "policySnapshot"->>'operatingMode'='STAGED_PREPARATION_QC' LOOP
    FOR stage_id IN
      WITH RECURSIVE affected AS (
        SELECT id,code FROM "FleetInstallationStage" WHERE "preparationId"=prep_id AND definition->>'component'=component_kind
        UNION
        SELECT s.id,s.code FROM "FleetInstallationStage" s JOIN affected a ON s.definition->'dependencies' ? a.code WHERE s."preparationId"=prep_id
      ) SELECT id FROM affected
    LOOP
      UPDATE "FleetInstallationStage" SET status='WAITING',revision=revision+1,checklist='{}',"componentSnapshot"=NULL,"submittedAt"=NULL,"submittedById"=NULL,"reviewedAt"=NULL,"reviewedById"=NULL,reason='Installed component changed; reconfirm stage.',"failedItems"=ARRAY[]::TEXT[],"updatedAt"=CURRENT_TIMESTAMP WHERE id=stage_id;
    END LOOP;
    IF EXISTS (SELECT 1 FROM "FleetPreparationRevision" r JOIN "FleetPreparation" p ON r."preparationId"=p.id AND r.revision=p."currentRevision" WHERE p.id=prep_id AND (r.checklist<>'{}'::jsonb OR EXISTS (SELECT 1 FROM "Photo" ph WHERE ph."entityId"=r.id AND ph."entityType"::text='PREPARATION'))) THEN
      UPDATE "FleetPreparation" SET "currentRevision"="currentRevision"+1 WHERE id=prep_id;
      INSERT INTO "FleetPreparationRevision" (id,"clientId","preparationId",revision) SELECT gen_random_uuid()::text,"clientId",id,"currentRevision" FROM "FleetPreparation" WHERE id=prep_id;
    END IF;
    INSERT INTO "FleetPreparationEvent" (id,"clientId","preparationId",action,data,"createdAt") SELECT gen_random_uuid()::text,"clientId",id,'INSTALLATION_INVALIDATED',jsonb_build_object('component',component_kind),CURRENT_TIMESTAMP FROM "FleetPreparation" WHERE id=prep_id;
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION readiness_component_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind TEXT;
BEGIN
  kind:=CASE WHEN TG_TABLE_NAME='FleetBatteryHistory' THEN 'BATTERY' ELSE 'CONTROLLER' END;
  IF TG_OP <> 'INSERT' THEN PERFORM invalidate_installation_component(OLD."fleetId",kind); PERFORM invalidate_fleet_readiness(OLD."fleetId",'Installed component changed.'); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM invalidate_installation_component(NEW."fleetId",kind); PERFORM invalidate_fleet_readiness(NEW."fleetId",'Installed component changed.'); END IF;
  RETURN NULL;
END $$;
CREATE FUNCTION installation_iot_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM invalidate_installation_component(NEW.id,'IOT'); RETURN NEW;
END $$;
CREATE TRIGGER installation_iot_changed AFTER UPDATE OF "iotDeviceId" ON "Fleet" FOR EACH ROW WHEN (OLD."iotDeviceId" IS DISTINCT FROM NEW."iotDeviceId") EXECUTE FUNCTION installation_iot_changed();
-- Identity edits are also component changes, even if an association id is unchanged.
CREATE OR REPLACE FUNCTION readiness_component_identity_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f TEXT; kind TEXT;
BEGIN
  kind:=CASE WHEN TG_TABLE_NAME='Battery' THEN 'BATTERY' WHEN TG_TABLE_NAME='Controller' THEN 'CONTROLLER' ELSE 'IOT' END;
  IF kind='BATTERY' THEN
    FOR f IN SELECT "fleetId" FROM "FleetBatteryHistory" WHERE "batteryId"=NEW.id AND "removedAt" IS NULL LOOP PERFORM invalidate_installation_component(f,kind); PERFORM invalidate_fleet_readiness(f,'Battery identity changed.'); END LOOP;
  ELSIF kind='CONTROLLER' THEN
    FOR f IN SELECT "fleetId" FROM "FleetControllerHistory" WHERE "controllerId"=NEW.id AND "removedAt" IS NULL LOOP PERFORM invalidate_installation_component(f,kind); PERFORM invalidate_fleet_readiness(f,'Controller identity changed.'); END LOOP;
  ELSE
    FOR f IN SELECT id FROM "Fleet" WHERE "iotDeviceId"=NEW.id LOOP PERFORM invalidate_installation_component(f,kind); PERFORM invalidate_fleet_readiness(f,'IoT identity changed.'); END LOOP;
  END IF;
  RETURN NEW;
END $$;
-- No approval can be installed while required stages remain incomplete.
CREATE FUNCTION installation_final_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='APPROVED' AND EXISTS (SELECT 1 FROM "FleetInstallationStage" s WHERE s."preparationId"=NEW.id AND s.status<>'COMPLETED') THEN RAISE EXCEPTION 'PREPARATION_QC_REQUIRED: Complete installation stages before QC approval.'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER installation_final_gate BEFORE UPDATE OF status ON "FleetPreparation" FOR EACH ROW EXECUTE FUNCTION installation_final_gate();

-- Prevent concurrent installation APIs from attaching hardware to two vehicles.
CREATE UNIQUE INDEX battery_one_active_installation ON "FleetBatteryHistory"("batteryId") WHERE "removedAt" IS NULL;
CREATE UNIQUE INDEX controller_one_active_installation ON "FleetControllerHistory"("controllerId") WHERE "removedAt" IS NULL;
