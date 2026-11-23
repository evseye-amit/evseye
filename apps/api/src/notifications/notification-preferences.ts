import { Prisma } from '@prisma/client';

// Server-owned policy; clients cannot downgrade essential notifications.
export const mandatoryCategory = (code: string) =>
  code.startsWith('PG06_') ||
  code.startsWith('PG09_') ||
  [
    'PG02_ACCOUNT_SECURITY',
    'PG02_LOGIN_ALERTS',
    'PG02_MOBILE_VERIFICATION',
    'PG02_OTP_PENDING',
  ].includes(code);

/** Dispatch-only predicate. Preferences never delete or hide inbox history. Aliases n,m. */
export function pushPreferenceEligibility() {
  return Prisma.sql`(
    m."categoryCode" IS NULL OR (
      (m."categoryCode" NOT LIKE 'PG11\\_%' ESCAPE '\\' OR EXISTS (
        SELECT 1 FROM "NotificationConsent" c WHERE c."clientId"=n."clientId" AND c."userId"=n."userId"
          AND c.application=m.application AND c."marketingEnabled"
      ))
      AND (m."categoryCode" LIKE 'PG06\\_%' ESCAPE '\\' OR m."categoryCode" LIKE 'PG09\\_%' ESCAPE '\\'
        OR m."categoryCode" IN ('PG02_ACCOUNT_SECURITY','PG02_LOGIN_ALERTS','PG02_MOBILE_VERIFICATION','PG02_OTP_PENDING')
        OR NOT EXISTS (SELECT 1 FROM "NotificationPreference" p
          WHERE p."clientId"=n."clientId" AND p."userId"=n."userId" AND p.application=m.application
            AND p."categoryCode"=m."categoryCode" AND NOT p."pushEnabled"))
    )
  )`;
}
