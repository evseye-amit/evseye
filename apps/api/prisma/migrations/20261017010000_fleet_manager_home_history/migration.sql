BEGIN;
-- Prevent writes during baseline capture; readers remain available.
LOCK TABLE "Fleet", "Rider", "User", "UserHub", "Allocation", "RentalTerminationRequest", "VehicleExchangeRequest", "VehicleSubmission" IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE "FleetManagerHomeHistory" (
 "id" BIGSERIAL PRIMARY KEY, "clientId" TEXT NOT NULL,
 "entityType" VARCHAR(40) NOT NULL, "entityId" TEXT NOT NULL,
 "recordedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(), "data" JSONB
);
CREATE INDEX "fm_home_history_lookup"
 ON "FleetManagerHomeHistory" ("clientId", "entityType", "entityId", "recordedAt", "id");
CREATE TABLE "FleetManagerHomeHistoryCoverage" ("id" TEXT PRIMARY KEY DEFAULT 'initial', "availableFrom" TIMESTAMPTZ(6) NOT NULL);
CREATE FUNCTION record_fleet_manager_home_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_data JSONB; previous_data JSONB; projected JSONB;
BEGIN
 IF TG_OP <> 'INSERT' THEN previous_data := to_jsonb(OLD); END IF;
 IF TG_OP = 'DELETE' THEN
   IF previous_data->>'clientId' IS NOT NULL THEN
     INSERT INTO "FleetManagerHomeHistory" ("clientId", "entityType", "entityId", "data")
     VALUES (previous_data->>'clientId', TG_TABLE_NAME, previous_data->>'id', NULL);
   END IF;
   RETURN OLD;
 END IF;
 row_data := to_jsonb(NEW);
 IF TG_OP = 'UPDATE' AND previous_data->>'clientId' IS DISTINCT FROM row_data->>'clientId' AND previous_data->>'clientId' IS NOT NULL THEN
   INSERT INTO "FleetManagerHomeHistory" ("clientId", "entityType", "entityId", "data")
   VALUES (previous_data->>'clientId', TG_TABLE_NAME, previous_data->>'id', NULL);
 END IF;
 IF row_data->>'clientId' IS NULL THEN RETURN NEW; END IF;
 SELECT jsonb_object_agg(key, value) INTO projected FROM jsonb_each(row_data) WHERE key = ANY(TG_ARGV);
 IF TG_OP = 'UPDATE' AND NOT EXISTS (
   SELECT 1 FROM jsonb_each(projected) WHERE value IS DISTINCT FROM previous_data->key
 ) THEN RETURN NEW; END IF;
 INSERT INTO "FleetManagerHomeHistory" ("clientId", "entityType", "entityId", "data")
 VALUES (row_data->>'clientId', TG_TABLE_NAME, row_data->>'id', projected);
 RETURN NEW;
END; $$;
INSERT INTO "FleetManagerHomeHistory" ("clientId", "entityType", "entityId", "data")
 SELECT t."clientId", 'Fleet', t."id", jsonb_build_object('id', t."id", 'clientId', t."clientId", 'homeHubId', t."homeHubId", 'currentHubId', t."currentHubId", 'status', t."status", 'onboardingStatus', t."onboardingStatus", 'allocationEnabled', t."allocationEnabled", 'deletedAt', t."deletedAt") FROM "Fleet" t WHERE t."clientId" IS NOT NULL;
CREATE TRIGGER fleet_manager_home_history AFTER INSERT OR UPDATE OR DELETE ON "Fleet"
 FOR EACH ROW EXECUTE FUNCTION record_fleet_manager_home_history('id', 'clientId', 'homeHubId', 'currentHubId', 'status', 'onboardingStatus', 'allocationEnabled', 'deletedAt');
INSERT INTO "FleetManagerHomeHistory" ("clientId", "entityType", "entityId", "data")
 SELECT t."clientId", 'Rider', t."id", jsonb_build_object('id', t."id", 'clientId', t."clientId", 'userId', t."userId", 'status', t."status", 'deletedAt', t."deletedAt") FROM "Rider" t WHERE t."clientId" IS NOT NULL;
CREATE TRIGGER fleet_manager_home_history AFTER INSERT OR UPDATE OR DELETE ON "Rider"
 FOR EACH ROW EXECUTE FUNCTION record_fleet_manager_home_history('id', 'clientId', 'userId', 'status', 'deletedAt');
INSERT INTO "FleetManagerHomeHistory" ("clientId", "entityType", "entityId", "data")
 SELECT t."clientId", 'User', t."id", jsonb_build_object('id', t."id", 'clientId', t."clientId", 'role', t."role", 'isActive', t."isActive", 'deletedAt', t."deletedAt") FROM "User" t WHERE t."clientId" IS NOT NULL;
CREATE TRIGGER fleet_manager_home_history AFTER INSERT OR UPDATE OR DELETE ON "User"
 FOR EACH ROW EXECUTE FUNCTION record_fleet_manager_home_history('id', 'clientId', 'role', 'isActive', 'deletedAt');
INSERT INTO "FleetManagerHomeHistory" ("clientId", "entityType", "entityId", "data")
 SELECT t."clientId", 'UserHub', t."id", jsonb_build_object('id', t."id", 'clientId', t."clientId", 'userId', t."userId", 'hubId', t."hubId", 'isPrimary', t."isPrimary") FROM "UserHub" t WHERE t."clientId" IS NOT NULL;
CREATE TRIGGER fleet_manager_home_history AFTER INSERT OR UPDATE OR DELETE ON "UserHub"
 FOR EACH ROW EXECUTE FUNCTION record_fleet_manager_home_history('id', 'clientId', 'userId', 'hubId', 'isPrimary');
INSERT INTO "FleetManagerHomeHistory" ("clientId", "entityType", "entityId", "data")
 SELECT t."clientId", 'Allocation', t."id", jsonb_build_object('id', t."id", 'clientId', t."clientId", 'fleetId', t."fleetId", 'riderId', t."riderId", 'status', t."status", 'createdAt', t."createdAt") FROM "Allocation" t WHERE t."clientId" IS NOT NULL;
CREATE TRIGGER fleet_manager_home_history AFTER INSERT OR UPDATE OR DELETE ON "Allocation"
 FOR EACH ROW EXECUTE FUNCTION record_fleet_manager_home_history('id', 'clientId', 'fleetId', 'riderId', 'status', 'createdAt');
INSERT INTO "FleetManagerHomeHistory" ("clientId", "entityType", "entityId", "data")
 SELECT t."clientId", 'RentalTerminationRequest', t."id", jsonb_build_object('id', t."id", 'clientId', t."clientId", 'allocationId', t."allocationId", 'plannedHubId', t."plannedHubId", 'status', t."status", 'submissionRequired', t."submissionRequired", 'requestedTerminationDate', t."requestedTerminationDate") FROM "RentalTerminationRequest" t WHERE t."clientId" IS NOT NULL;
CREATE TRIGGER fleet_manager_home_history AFTER INSERT OR UPDATE OR DELETE ON "RentalTerminationRequest"
 FOR EACH ROW EXECUTE FUNCTION record_fleet_manager_home_history('id', 'clientId', 'allocationId', 'plannedHubId', 'status', 'submissionRequired', 'requestedTerminationDate');
INSERT INTO "FleetManagerHomeHistory" ("clientId", "entityType", "entityId", "data")
 SELECT t."clientId", 'VehicleExchangeRequest', t."id", jsonb_build_object('id', t."id", 'clientId', t."clientId", 'oldAllocationId', t."oldAllocationId", 'plannedHubId', t."plannedHubId", 'status', t."status", 'submissionRequired', t."submissionRequired", 'plannedReturnDate', t."plannedReturnDate") FROM "VehicleExchangeRequest" t WHERE t."clientId" IS NOT NULL;
CREATE TRIGGER fleet_manager_home_history AFTER INSERT OR UPDATE OR DELETE ON "VehicleExchangeRequest"
 FOR EACH ROW EXECUTE FUNCTION record_fleet_manager_home_history('id', 'clientId', 'oldAllocationId', 'plannedHubId', 'status', 'submissionRequired', 'plannedReturnDate');
INSERT INTO "FleetManagerHomeHistory" ("clientId", "entityType", "entityId", "data")
 SELECT t."clientId", 'VehicleSubmission', t."id", jsonb_build_object('id', t."id", 'clientId', t."clientId", 'allocationId', t."allocationId", 'returnRequestId', t."returnRequestId", 'exchangeRequestId', t."exchangeRequestId", 'hubId', t."hubId", 'status', t."status", 'mechanicChecksComplete', t."mechanicChecksComplete") FROM "VehicleSubmission" t WHERE t."clientId" IS NOT NULL;
CREATE TRIGGER fleet_manager_home_history AFTER INSERT OR UPDATE OR DELETE ON "VehicleSubmission"
 FOR EACH ROW EXECUTE FUNCTION record_fleet_manager_home_history('id', 'clientId', 'allocationId', 'returnRequestId', 'exchangeRequestId', 'hubId', 'status', 'mechanicChecksComplete');
INSERT INTO "FleetManagerHomeHistoryCoverage" ("id", "availableFrom") VALUES ('initial', clock_timestamp());
COMMIT;
