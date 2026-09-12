-- PackageFeature is the source of normal package entitlement. ClientFeature is
-- reserved for client-specific add-ons, overrides, and promotions.
-- Preserve existing package-derived rows that have negotiated pricing as custom
-- overrides; remove the redundant rows that have no client-specific pricing.
UPDATE "ClientFeature"
SET "source" = 'CUSTOM'
WHERE "source" = 'PACKAGE'
  AND EXISTS (
    SELECT 1
    FROM "ClientFeaturePricing"
    WHERE "ClientFeaturePricing"."clientFeatureId" = "ClientFeature"."id"
  );

DELETE FROM "ClientFeature"
WHERE "source" = 'PACKAGE'
  AND NOT EXISTS (
    SELECT 1
    FROM "ClientFeaturePricing"
    WHERE "ClientFeaturePricing"."clientFeatureId" = "ClientFeature"."id"
  );
