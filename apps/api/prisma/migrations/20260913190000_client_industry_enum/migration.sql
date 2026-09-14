-- Store a stable industry code and keep the user-facing label in the application.
CREATE TYPE "ClientIndustry" AS ENUM (
  'LOGISTICS',
  'LAST_MILE',
  'DELIVERY',
  'MOBILITY',
  'RENTAL',
  'OTHER'
);

ALTER TABLE "ClientBusinessProfile"
  ALTER COLUMN "industry" TYPE "ClientIndustry"
  USING (
    CASE
      WHEN "industry" IS NULL OR btrim("industry") = '' THEN NULL
      WHEN upper(replace(btrim("industry"), '-', '_')) = 'LOGISTICS' THEN 'LOGISTICS'
      WHEN upper(replace(btrim("industry"), '-', '_')) = 'LAST_MILE' THEN 'LAST_MILE'
      WHEN upper(replace(btrim("industry"), '-', '_')) = 'DELIVERY' THEN 'DELIVERY'
      WHEN upper(replace(btrim("industry"), '-', '_')) = 'MOBILITY' THEN 'MOBILITY'
      WHEN upper(replace(btrim("industry"), '-', '_')) = 'RENTAL' THEN 'RENTAL'
      ELSE 'OTHER'
    END
  )::"ClientIndustry";
