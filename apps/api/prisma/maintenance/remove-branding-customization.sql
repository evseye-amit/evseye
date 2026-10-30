-- Existing development databases: apply after building the updated API/web.
-- Fresh databases use the updated schema baseline and need no cleanup.
BEGIN;
ALTER TABLE "ClientBranding"
  DROP COLUMN IF EXISTS "primaryColor",
  DROP COLUMN IF EXISTS "secondaryColor",
  DROP COLUMN IF EXISTS "accentColor",
  DROP COLUMN IF EXISTS "loginTitle",
  DROP COLUMN IF EXISTS "loginSubtitle";
COMMIT;
