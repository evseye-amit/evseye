ALTER TYPE "FleetStatus" ADD VALUE 'BROKEN';
ALTER TYPE "FleetStatus" ADD VALUE 'AWAITING_PARTS';
CREATE TYPE "MaintenanceIssueCategory" AS ENUM ('POWERTRAIN','BATTERY','ELECTRICAL','BRAKES','TYRES_WHEELS','SUSPENSION_STEERING','BODY_CHASSIS','ACCESSORIES','OTHER');
CREATE TYPE "MaintenanceIssueStatus" AS ENUM ('OPEN','IN_PROGRESS','RESOLVED');
ALTER TABLE "VehicleSubmissionReport" ADD COLUMN "fleetStatus" "FleetStatus", ADD COLUMN "issues" JSONB NOT NULL DEFAULT '[]';
CREATE TABLE "VehicleMaintenanceIssue" (
 "id" UUID PRIMARY KEY, "clientId" TEXT NOT NULL, "fleetId" TEXT NOT NULL,
 "submissionId" TEXT NOT NULL, "category" "MaintenanceIssueCategory" NOT NULL,
 "description" VARCHAR(2000) NOT NULL, "status" "MaintenanceIssueStatus" NOT NULL DEFAULT 'OPEN',
 "evidencePhotoIds" TEXT[] NOT NULL, "requiredParts" VARCHAR(1000), "penaltyFindingId" UUID,
 "lastReportId" TEXT NOT NULL, "updatedById" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "VehicleMaintenanceIssue_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "VehicleSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "VehicleMaintenanceIssue_lastReportId_fkey" FOREIGN KEY ("lastReportId") REFERENCES "VehicleSubmissionReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "VehicleMaintenanceIssue_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "VehicleMaintenanceIssue_clientId_fleetId_status_idx" ON "VehicleMaintenanceIssue"("clientId","fleetId","status");
CREATE INDEX "VehicleMaintenanceIssue_clientId_category_idx" ON "VehicleMaintenanceIssue"("clientId","category");

-- Enforce maintenance holds even when a different API attempts to release a scooter.
CREATE FUNCTION guard_unresolved_fleet_issues() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.status::text IN ('AVAILABLE','RESERVED','ALLOCATION_IN_PROGRESS','ALLOCATED','IN_USE') OR NEW."allocationEnabled") AND EXISTS (
  SELECT 1 FROM "VehicleMaintenanceIssue" i WHERE i."fleetId"=NEW.id AND i."clientId"=NEW."clientId" AND i.status <> 'RESOLVED'
 ) THEN RAISE EXCEPTION 'Resolve outstanding maintenance issues before deployment' USING ERRCODE='23514'; END IF;
 IF NEW.status::text IN ('BROKEN','AWAITING_PARTS') AND NEW."allocationEnabled" THEN
  RAISE EXCEPTION 'Maintenance fleet cannot be enabled for allocation' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER unresolved_fleet_issues BEFORE INSERT OR UPDATE ON "Fleet" FOR EACH ROW EXECUTE FUNCTION guard_unresolved_fleet_issues();
CREATE FUNCTION lock_maintenance_issue_fleet() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM id FROM "Fleet" WHERE id=NEW."fleetId" AND "clientId"=NEW."clientId" FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Maintenance issue client or fleet mismatch' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS (SELECT 1 FROM "VehicleSubmission" s WHERE s.id=NEW."submissionId" AND s."clientId"=NEW."clientId" AND s."fleetId"=NEW."fleetId") THEN
  RAISE EXCEPTION 'Maintenance issue submission mismatch' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER maintenance_issue_fleet_lock BEFORE INSERT OR UPDATE ON "VehicleMaintenanceIssue" FOR EACH ROW EXECUTE FUNCTION lock_maintenance_issue_fleet();
