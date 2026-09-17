-- OEM logos are stored as object keys and resolved to delivery URLs at runtime.
-- This prevents environment-specific paths and bucket URLs from being persisted.
ALTER TABLE "Oem" DROP COLUMN "logoUrl";
