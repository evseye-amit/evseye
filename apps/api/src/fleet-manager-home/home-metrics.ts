import {
  riderHubExpression,
  visibleRiderHub,
} from '../rider-access/rider-hub-policy.js';
import { Prisma } from '@prisma/client';

export const HOME_TIMEZONE = 'Asia/Kolkata';
const IST_OFFSET_MS = 330 * 60_000;

/** Yesterday is the half-open interval ending at today's local midnight. */
export function homeDates(now: Date) {
  const today = new Date(now.getTime() + IST_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
  const cutoff = new Date(`${today}T00:00:00+05:30`);
  const yesterday = new Date(cutoff.getTime() - 86_400_000 + IST_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
  return { today, yesterday, cutoff };
}

const tables = [
  'Fleet',
  'Rider',
  'User',
  'UserHub',
  'Allocation',
  'RentalTerminationRequest',
  'VehicleExchangeRequest',
  'VehicleSubmission',
] as const;

function stateTables(clientId: string, cutoff?: Date) {
  return Prisma.join(
    tables.map((table) => {
      // Identifiers are hard-coded above; all request values remain bound parameters.
      const identifier = Prisma.raw(`"${table}"`);
      if (!cutoff)
        return Prisma.sql`${identifier} AS (SELECT * FROM public.${identifier} WHERE "clientId" = ${clientId})`;
      return Prisma.sql`${identifier} AS (
      SELECT (jsonb_populate_record(NULL::public.${identifier}, revision."data")).*
      FROM (
        SELECT DISTINCT ON ("entityId") "data" FROM "FleetManagerHomeHistory"
        WHERE "clientId" = ${clientId} AND "entityType" = ${table} AND "recordedAt" < ${cutoff}
        ORDER BY "entityId", "recordedAt" DESC, "id" DESC
      ) revision WHERE revision."data" IS NOT NULL
    )`;
    }),
  );
}

/** Live and historical reads use the same association; missing associations join the MVP queue. */
export function attributedRidersCte() {
  return Prisma.sql`riders_scoped AS (
    SELECT r.*, ${riderHubExpression()} AS "attributedHubId"
    FROM "Rider" r WHERE r."deletedAt" IS NULL AND r.status = 'ACTIVE'
      AND (r."userId" IS NULL OR EXISTS (SELECT 1 FROM "User" u WHERE u.id = r."userId"
        AND u."isActive" AND u."deletedAt" IS NULL))
  )`;
}

/** Only allocations cancelled before handover allow a rider back into the first-allocation queue. */
function awaitingFirstAllocation() {
  return Prisma.sql`NOT EXISTS (SELECT 1 FROM "Allocation" a WHERE a."riderId" = r.id
    AND (a.status <> 'CANCELLED' OR a."allocatedAt" IS NOT NULL))`;
}

export function pendingRiderIdsQuery(clientId: string, hubIds: string[]) {
  return Prisma.sql`WITH ${stateTables(clientId)}, ${attributedRidersCte()}
    SELECT r.id FROM riders_scoped r WHERE ${visibleRiderHub(hubIds)}
    AND ${awaitingFirstAllocation()}`;
}

export interface HomeCounts {
  pendingAllocation: number;
  pendingSubmission: number;
  readyForDeployment: number;
  underMaintenance: number;
  totalFleet: number;
  allocatedFleet: number;
  occupiedSlots: number;
  activeRiders: number;
}

export function homeCountsQuery(
  clientId: string,
  hubId: string,
  now: Date,
  cutoff?: Date,
) {
  return Prisma.sql`WITH ${stateTables(clientId, cutoff)}, ${attributedRidersCte()},
    requests AS (
      SELECT 'RETURN' AS source, t.id, t."allocationId", t."plannedHubId", t.status
      FROM "RentalTerminationRequest" t WHERE t."submissionRequired"
        AND t.status NOT IN ('CANCELLED','REJECTED') AND t."requestedTerminationDate" < ${cutoff ?? now}
      UNION ALL
      SELECT 'EXCHANGE', e.id, e."oldAllocationId", e."plannedHubId", e.status::text
      FROM "VehicleExchangeRequest" e WHERE e."submissionRequired"
        AND e.status NOT IN ('CANCELLED','REJECTED','EXPIRED') AND e."plannedReturnDate" < ${cutoff ?? now}
    ), pending_submissions AS (
      SELECT DISTINCT COALESCE(r."allocationId", r.source || ':' || r.id) AS id
      FROM requests r LEFT JOIN "VehicleSubmission" s
        ON (r.source = 'RETURN' AND s."returnRequestId" = r.id)
        OR (r.source = 'EXCHANGE' AND s."exchangeRequestId" = r.id)
      WHERE COALESCE(s."hubId", r."plannedHubId") = ${hubId}
        AND ((s.id IS NOT NULL AND (s.status <> 'CONFIRMED' OR NOT s."mechanicChecksComplete"))
          OR (s.id IS NULL AND r.status NOT IN ('COMPLETED','RETURNED','TERMINATED')))
    )
    SELECT
      (SELECT COUNT(*)::int FROM riders_scoped r WHERE ${visibleRiderHub([hubId])}
        AND ${awaitingFirstAllocation()}) AS "pendingAllocation",
      (SELECT COUNT(*)::int FROM pending_submissions) AS "pendingSubmission",
      COUNT(*) FILTER (WHERE f."currentHubId" = ${hubId} AND f.status = 'AVAILABLE'
        AND f."onboardingStatus" = 'ACTIVE' AND f."allocationEnabled"
        AND NOT EXISTS (SELECT 1 FROM "Allocation" a WHERE a."fleetId" = f.id
          AND a.status IN ('INITIATED','INSPECTION_PENDING','OTP_PENDING','ACTIVE','DEALLOCATION_INITIATED')))::int AS "readyForDeployment",
      COUNT(*) FILTER (WHERE COALESCE(f."currentHubId", f."homeHubId") = ${hubId} AND f.status = 'MAINTENANCE')::int AS "underMaintenance",
      COUNT(*) FILTER (WHERE COALESCE(f."homeHubId", f."currentHubId") = ${hubId} AND f."onboardingStatus" = 'ACTIVE')::int AS "totalFleet",
      COUNT(*) FILTER (WHERE COALESCE(f."homeHubId", f."currentHubId") = ${hubId} AND f."onboardingStatus" = 'ACTIVE'
        AND EXISTS (SELECT 1 FROM "Allocation" a WHERE a."fleetId" = f.id AND a.status IN ('ACTIVE','DEALLOCATION_INITIATED')))::int AS "allocatedFleet",
      COUNT(*) FILTER (WHERE f."currentHubId" = ${hubId} AND f.status IN
        ('AVAILABLE','RESERVED','ALLOCATION_IN_PROGRESS','INSPECTION_PENDING','MAINTENANCE','OUT_OF_SERVICE'))::int AS "occupiedSlots",
      (SELECT COUNT(*)::int FROM riders_scoped r WHERE r."attributedHubId" = ${hubId}) AS "activeRiders"
    FROM "Fleet" f WHERE f."deletedAt" IS NULL`;
}

export function riderAttendanceQuery(
  clientId: string,
  hubId: string,
  now: Date,
) {
  return Prisma.sql`WITH ${stateTables(clientId)}, ${attributedRidersCte()}
    SELECT COUNT(*)::int AS present FROM riders_scoped r WHERE r."attributedHubId" = ${hubId}
      AND EXISTS (SELECT 1 FROM "AttendancePeriod" p WHERE p."clientId" = ${clientId}
        AND p."userId" = r."userId" AND p."checkInAt" <= ${now}
        AND (p."checkOutAt" IS NULL OR p."checkOutAt" > ${now}))`;
}
