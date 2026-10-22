-- Readiness is a fleet choice captured at creation.  The company setting remains
-- the default for new fleets only.
ALTER TABLE "Fleet" ADD COLUMN "readinessWorkflow" "FleetOperatingMode";
ALTER TABLE "Fleet" ADD COLUMN "readinessStagePlanCode" VARCHAR(80);

UPDATE "Fleet" f
SET "readinessWorkflow" = CASE
  WHEN c."fleetOperatingMode" = 'ONBOARDING_EVIDENCE' THEN 'SIMPLE'::"FleetOperatingMode"
  ELSE c."fleetOperatingMode"
END
FROM "Client" c
WHERE c.id = f."clientId";

-- Existing staged fleets keep a null plan until an operator explicitly selects
-- one. Legacy policy stages are mapped to the Standard compatibility plan only
-- when read, never guessed into a fleet row during migration.

UPDATE "Fleet" SET "readinessWorkflow" = 'SIMPLE' WHERE "readinessWorkflow" IS NULL;
ALTER TABLE "Fleet" ALTER COLUMN "readinessWorkflow" SET DEFAULT 'SIMPLE';
ALTER TABLE "Fleet" ALTER COLUMN "readinessWorkflow" SET NOT NULL;

-- Only one unfinished transfer may hold a fleet at a time.
CREATE UNIQUE INDEX "FleetTransfer_one_open_per_fleet"
  ON "FleetTransfer"("fleetId")
  WHERE "status" IN ('INITIATED', 'IN_TRANSIT');

-- Enforce the saved fleet workflow.  Company policy changes do not rewrite old
-- fleet choices or invalidate an active fleet merely because the default moved.
CREATE OR REPLACE FUNCTION enforce_fleet_readiness() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prep_mode BOOLEAN; invalidated BOOLEAN := FALSE;
BEGIN
  prep_mode := NEW."readinessWorkflow"::text IN ('PREPARATION_QC','STAGED_PREPARATION_QC');
  IF TG_OP='UPDATE' THEN
    invalidated := OLD."currentHubId" IS DISTINCT FROM NEW."currentHubId" OR OLD."iotDeviceId" IS DISTINCT FROM NEW."iotDeviceId"
      OR (NEW.status IN ('MAINTENANCE','OUT_OF_SERVICE') AND OLD.status IS DISTINCT FROM NEW.status)
      OR (OLD.status IN ('ALLOCATED','IN_USE','DEALLOCATION_IN_PROGRESS') AND NEW.status NOT IN ('ALLOCATED','IN_USE','DEALLOCATION_IN_PROGRESS'));
    -- A real, recorded receipt in this transaction is the one permitted hub
    -- move that retains an approved preparation. The application marks the
    -- transfer with a transaction-local GUC before updating Fleet. Matching
    -- older RECEIVED rows must not exempt manual hub edits.
    IF OLD."currentHubId" IS DISTINCT FROM NEW."currentHubId" AND EXISTS (
      SELECT 1 FROM "FleetTransfer" t
      WHERE t.id = NULLIF(current_setting('evseye.fleet_transfer_receipt_id', true), '')
        AND t."fleetId"=NEW.id AND t.status='RECEIVED'
        AND t."toHubId"=NEW."currentHubId" AND t."receivedAt" IS NOT NULL
        AND t."fromHubId"=OLD."currentHubId"
    ) THEN
      invalidated := OLD."iotDeviceId" IS DISTINCT FROM NEW."iotDeviceId"
        OR (NEW.status IN ('MAINTENANCE','OUT_OF_SERVICE') AND OLD.status IS DISTINCT FROM NEW.status)
        OR (OLD.status IN ('ALLOCATED','IN_USE','DEALLOCATION_IN_PROGRESS') AND NEW.status NOT IN ('ALLOCATED','IN_USE','DEALLOCATION_IN_PROGRESS'));
    END IF;
    -- Preserve staged installation's IoT binding exception from the prior trigger.
    IF OLD."iotDeviceId" IS DISTINCT FROM NEW."iotDeviceId"
      AND OLD."currentHubId" IS NOT DISTINCT FROM NEW."currentHubId"
      AND OLD.status IS NOT DISTINCT FROM NEW.status
      AND EXISTS (SELECT 1 FROM "FleetPreparation" p WHERE p."fleetId"=NEW.id AND p.status='IN_PROGRESS' AND p."policySnapshot"->>'operatingMode'='STAGED_PREPARATION_QC')
    THEN invalidated:=FALSE; END IF;
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
    SELECT 1 FROM "FleetPreparation" p WHERE p.id=NEW."readinessApprovedPreparationId" AND p."clientId"=NEW."clientId" AND p."fleetId"=NEW.id
      AND (p."hubId"=NEW."currentHubId" OR EXISTS (
        SELECT 1 FROM "FleetTransfer" t WHERE t."fleetId"=NEW.id AND t.status='RECEIVED'
          AND t.id = NULLIF(current_setting('evseye.fleet_transfer_receipt_id', true), '')
          AND t."toHubId"=NEW."currentHubId" AND t."fromHubId"=p."hubId" AND t."receivedAt" IS NOT NULL
      )) AND p.status='APPROVED'
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
  SELECT f."readinessWorkflow"::text IN ('PREPARATION_QC','STAGED_PREPARATION_QC'), f."readinessApprovedPreparationId",
    (NOT f."allocationEnabled" OR f."allocationBlockedByAdmin")
    INTO prep_mode, approved, disabled
    FROM "Fleet" f WHERE f.id=NEW."fleetId" AND f."clientId"=NEW."clientId" FOR UPDATE;
  IF disabled THEN RAISE EXCEPTION 'FLEET_ALLOCATION_BLOCKED: Allocation is administratively disabled.' USING ERRCODE='P0001'; END IF;
  IF prep_mode AND approved IS NULL THEN RAISE EXCEPTION 'PREPARATION_QC_REQUIRED: Scooter requires current preparation and QC approval.' USING ERRCODE='P0001'; END IF;
  RETURN NEW;
END $$;
