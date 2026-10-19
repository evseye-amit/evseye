-- Preserve historical issue categories while allowing uncategorised submission issues.
ALTER TABLE "VehicleMaintenanceIssue" ALTER COLUMN "category" DROP NOT NULL;
