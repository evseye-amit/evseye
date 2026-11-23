-- AlterTable
ALTER TABLE "NotificationMessage" ADD COLUMN     "application" VARCHAR(30),
ADD COLUMN     "targetCities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "targetFleetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "targetHubIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "targetOemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "targetRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "targetVehicleTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "visibilityExpiresAt" TIMESTAMP(3),
ADD COLUMN     "visibilityPolicy" VARCHAR(20) NOT NULL DEFAULT 'PERSONAL',
ADD COLUMN     "withdrawnAt" TIMESTAMP(3);

ALTER TABLE "NotificationMessage"
  ADD CONSTRAINT "NotificationMessage_visibility_check" CHECK ("visibilityPolicy" IN ('PERSONAL','GENERAL','OPERATIONAL')),
  ADD CONSTRAINT "NotificationMessage_application_check" CHECK (application IS NULL OR application IN ('RIDER','FLEET_MANAGER','TEAM_LEADER','ADMIN'));

-- Preserve the existing immutable content/audience guard; withdrawal is one-way.
CREATE OR REPLACE FUNCTION guard_notification_message_content() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status','completedAt','senderId','withdrawnAt']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','completedAt','senderId','withdrawnAt']) THEN
    RAISE EXCEPTION 'Queued notification content and audience are immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."withdrawnAt" IS NOT NULL AND NEW."withdrawnAt" IS DISTINCT FROM OLD."withdrawnAt" THEN
    RAISE EXCEPTION 'Notification withdrawal cannot be reversed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
