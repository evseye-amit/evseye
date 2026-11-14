ALTER TABLE "PaymentTransaction" ADD COLUMN "failedAt" TIMESTAMP(3);
-- Preserve the earliest recorded failure; old rows without audit evidence use
-- their current update timestamp once, so subsequent polls cannot move it.
UPDATE "PaymentTransaction" t SET "failedAt" = COALESCE(
  (SELECT MIN(a."createdAt") FROM "AuditLog" a
   WHERE a."entityId"=t.id AND a."clientId"=t."clientId"
     AND a."entityType"='PaymentTransaction' AND a.action='AUTODEBIT_FAILED'),
  t."updatedAt") WHERE t.status='FAILED';
