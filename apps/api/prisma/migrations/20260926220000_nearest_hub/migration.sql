CREATE EXTENSION IF NOT EXISTS postgis;
ALTER TABLE "Hub" ADD COLUMN "location" geography(Point,4326);
UPDATE "Hub" SET "location" = ST_SetSRID(ST_MakePoint("longitude"::double precision, "latitude"::double precision),4326)::geography WHERE "latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180;
CREATE OR REPLACE FUNCTION sync_hub_location() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."latitude" BETWEEN -90 AND 90 AND NEW."longitude" BETWEEN -180 AND 180 THEN
    NEW."location" := ST_SetSRID(ST_MakePoint(NEW."longitude"::double precision, NEW."latitude"::double precision),4326)::geography;
  ELSE
    NEW."location" := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hub_location_sync BEFORE INSERT OR UPDATE OF "latitude", "longitude" ON "Hub" FOR EACH ROW EXECUTE FUNCTION sync_hub_location();
CREATE INDEX "idx_hub_location" ON "Hub" USING GIST ("location");
CREATE TABLE "RoutingProviderUsage" (
  "id" text PRIMARY KEY,
  "provider" text NOT NULL,
  "billingMonth" text NOT NULL,
  "requestCount" integer NOT NULL DEFAULT 0,
  "usageUnits" integer NOT NULL DEFAULT 0,
  "successCount" integer NOT NULL DEFAULT 0,
  "failureCount" integer NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("provider", "billingMonth")
);
