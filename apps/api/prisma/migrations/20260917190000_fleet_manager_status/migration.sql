ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Existing inactive Fleet Managers were created by the old delete action.
UPDATE "User"
SET "deletedAt" = CURRENT_TIMESTAMP
WHERE "role" = 'FLEET_MANAGER' AND "isActive" = false;
