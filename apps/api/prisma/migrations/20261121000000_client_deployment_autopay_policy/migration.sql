CREATE TABLE "ClientDeploymentAutoPayPolicy" (
  "clientId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT,
  CONSTRAINT "ClientDeploymentAutoPayPolicy_pkey" PRIMARY KEY ("clientId"),
  CONSTRAINT "ClientDeploymentAutoPayPolicy_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Preserve the already-enabled TEST rollout for eligible existing clients.
-- PRODUCTION merchants and new clients remain opt-in; platform flags still gate use.
INSERT INTO "ClientDeploymentAutoPayPolicy" ("clientId", "enabled", "revision", "updatedAt")
SELECT c.id, true, 1, CURRENT_TIMESTAMP
FROM "Client" c
JOIN LATERAL (
  SELECT s."packageId" FROM "ClientSubscription" s
  WHERE s."clientId" = c.id AND s.status = 'ACTIVE'
    AND s."startDate" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
    AND (s."endDate" IS NULL OR s."endDate" >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date)
  ORDER BY s."startDate" DESC LIMIT 1
) s ON true
JOIN "Package" p ON p.id = s."packageId" AND p."isActive"
JOIN "PackageFeature" pf ON pf."packageId" = p.id AND pf."isIncluded"
JOIN "Feature" f ON f.id = pf."featureId" AND f.code = 'RIDER_AUTO_PAY' AND f."isActive"
WHERE c.status = 'ACTIVE' AND c."isActive"
  AND f.configuration->'paymentMethods' @> '["UPI_AUTOPAY"]'::jsonb
  AND CASE WHEN f.configuration->>'mandateMaxAmount' ~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$'
    THEN (f.configuration->>'mandateMaxAmount')::numeric > 0 ELSE false END
  AND jsonb_typeof(f.configuration->'validityDays') = 'number'
  AND CASE WHEN f.configuration->>'validityDays' ~ '^[1-9][0-9]{0,15}$'
    THEN (f.configuration->>'validityDays')::numeric <= 9007199254740991 ELSE false END
  AND (f.configuration->>'authorizationAmount' IS NULL OR
    CASE WHEN f.configuration->>'authorizationAmount' ~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$'
      AND f.configuration->>'mandateMaxAmount' ~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$'
    THEN (f.configuration->>'authorizationAmount')::numeric > 0
      AND (f.configuration->>'authorizationAmount')::numeric <= (f.configuration->>'mandateMaxAmount')::numeric
    ELSE false END)
  AND (SELECT count(*) FROM "ClientPaymentProvider" m WHERE m."clientId" = c.id
    AND m.environment = 'TEST' AND m.status = 'ACTIVE' AND m."validFrom" <= CURRENT_TIMESTAMP
    AND (m."validUntil" IS NULL OR m."validUntil" >= CURRENT_TIMESTAMP)) = 1
  AND EXISTS (
    SELECT 1 FROM "ClientPaymentProvider" m
    JOIN "PaymentProviderConfigurationVersion" v ON v."providerConfigurationId" = m.id
      AND v."clientId" = m."clientId" AND v.version = m."currentVersion"
      AND v.provider = m.provider AND v.environment = m.environment
      AND v."keyId" = m."keyId" AND v."secretReference" = m."secretReference"
      AND v."credentialFingerprint" IS NOT NULL AND v."credentialFingerprint" <> ''
    WHERE m."clientId" = c.id AND m.provider = 'RAZORPAY' AND m.environment = 'TEST'
      AND m.status = 'ACTIVE' AND m."validFrom" <= CURRENT_TIMESTAMP
      AND (m."validUntil" IS NULL OR m."validUntil" >= CURRENT_TIMESTAMP)
  );

INSERT INTO "AuditLog" ("clientId", action, "entityType", "entityId", "previousData", "newData", "createdAt")
SELECT "clientId", 'DEPLOYMENT_AUTOPAY_POLICY_UPDATED', 'ClientDeploymentAutoPayPolicy', "clientId",
  NULL, jsonb_build_object('enabled', true, 'revision', 1, 'source', 'MIGRATION'), CURRENT_TIMESTAMP
FROM "ClientDeploymentAutoPayPolicy";
