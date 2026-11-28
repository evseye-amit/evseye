import { Prisma } from '@prisma/client';
import type { NotificationAudienceDto } from './notification.dto.js';

export const staffRoles = [
  'CLIENT_ADMIN',
  'FLEET_MANAGER',
  'TEAM_LEAD',
  'KYC_OPERATOR',
  'ADVISOR',
  'QC_MANAGER',
];
export const applicationRoles: Record<string, string[]> = {
  RIDER: ['RIDER'],
  FLEET_MANAGER: ['FLEET_MANAGER'],
  TEAM_LEADER: ['TEAM_LEAD'],
  ADMIN: staffRoles,
};
export const applicationDeviceCodes: Record<string, string> = {
  RIDER: 'RIDER_APP',
  FLEET_MANAGER: 'FLEET_MANAGER_APP',
  TEAM_LEADER: 'TEAM_LEADER_APP',
  ADMIN: 'ADMIN_WEB',
};
export const valuesSql = (values: string[]) =>
  values.length
    ? Prisma.sql`ARRAY[${Prisma.join(values)}]::text[]`
    : Prisma.sql`ARRAY[]::text[]`;
const unique = (values?: string[]) => [...new Set(values ?? [])].sort();
export function targetSnapshot(input: NotificationAudienceDto) {
  const fixed =
    input.audience === 'ALL_RIDERS'
      ? ['RIDER']
      : input.audience === 'ALL_FLEET_MANAGERS'
        ? ['FLEET_MANAGER']
        : input.audience === 'ALL_TEAM_LEADERS'
          ? ['TEAM_LEAD']
          : input.audience === 'ALL_EMPLOYEES'
            ? staffRoles
            : [];
  return {
    application: input.application ?? null,
    targetRoles: unique(
      input.roles?.length && fixed.length
        ? input.roles.filter((r) => fixed.includes(r))
        : input.roles?.length
          ? input.roles
          : fixed,
    ),
    targetHubIds: unique(input.hubIds),
    targetCities: unique(
      input.cities?.map((c) => c.trim().toLowerCase()).filter(Boolean),
    ),
    targetFleetIds: unique(input.fleetIds),
    targetVehicleTypeIds: unique(input.vehicleTypeIds),
    targetOemIds: unique(input.oemIds),
  };
}
type Fields = {
  roles: Prisma.Sql;
  hubs: Prisma.Sql;
  cities: Prisma.Sql;
  fleets: Prisma.Sql;
  types: Prisma.Sql;
  oems: Prisma.Sql;
  application: Prisma.Sql;
};
/** Uses fixed aliases u (User) and, for stored rules, m (NotificationMessage). No client SQL. */
function matches(f: Fields): Prisma.Sql {
  const noVehicle = Prisma.sql`cardinality(${f.fleets})=0 AND cardinality(${f.types})=0 AND cardinality(${f.oems})=0`;
  const noLocation = Prisma.sql`cardinality(${f.hubs})=0 AND cardinality(${f.cities})=0`;
  const hub = Prisma.sql`(cardinality(${f.hubs})=0 OR h.id = ANY(${f.hubs})) AND (cardinality(${f.cities})=0 OR lower(trim(h.city)) = ANY(${f.cities}))`;
  return Prisma.sql`
    (cardinality(${f.roles})=0 OR u.role::text = ANY(${f.roles}))
    AND (${f.application} IS NULL OR
      (${f.application}='RIDER' AND u.role='RIDER') OR
      (${f.application}='FLEET_MANAGER' AND u.role='FLEET_MANAGER') OR
      (${f.application}='TEAM_LEADER' AND u.role='TEAM_LEAD') OR
      (${f.application}='ADMIN' AND u.role::text = ANY(${valuesSql(staffRoles)})))
    AND ((${noVehicle} AND ${noLocation}) OR
      EXISTS (
        SELECT 1 FROM "Rider" r JOIN "Allocation" a ON a."riderId"=r.id AND a."clientId"=u."clientId"
        JOIN "Fleet" f ON f.id=a."fleetId" AND f."clientId"=u."clientId"
        LEFT JOIN "Hub" h ON h.id=COALESCE(f."currentHubId",f."homeHubId") AND h."clientId"=u."clientId" AND h."deletedAt" IS NULL
        WHERE u.role='RIDER' AND r."userId"=u.id AND r."clientId"=u."clientId" AND r."deletedAt" IS NULL
          AND a.status IN ('ACTIVE','DEALLOCATION_INITIATED') AND f."deletedAt" IS NULL
          AND (cardinality(${f.fleets})=0 OR f.id=ANY(${f.fleets}))
          AND (cardinality(${f.types})=0 OR f."vehicleTypeId"=ANY(${f.types}))
          AND (cardinality(${f.oems})=0 OR f."oemId"=ANY(${f.oems})) AND ${hub}
      ) OR (${noVehicle} AND EXISTS (
        SELECT 1 FROM "UserHub" uh JOIN "Hub" h ON h.id=uh."hubId" AND h."clientId"=u."clientId" AND h."deletedAt" IS NULL
        WHERE uh."userId"=u.id AND uh."clientId"=u."clientId" AND ${hub}
          AND (u.role <> 'RIDER' OR NOT EXISTS (
            SELECT 1 FROM "Rider" r JOIN "Allocation" a ON a."riderId"=r.id AND a."clientId"=u."clientId"
            WHERE r."userId"=u.id AND r."clientId"=u."clientId" AND r."deletedAt" IS NULL AND a.status IN ('ACTIVE','DEALLOCATION_INITIATED')
          ))
      )))`;
}
export function targetPredicate(input: NotificationAudienceDto) {
  const s = targetSnapshot(input);
  // Empty intersection must match nobody, not turn into an unrestricted rule.
  const fixed = targetSnapshot({ ...input, roles: undefined }).targetRoles;
  if (input.roles?.length && fixed.length && !s.targetRoles.length)
    return Prisma.sql`false`;
  return matches({
    roles: valuesSql(s.targetRoles),
    hubs: valuesSql(s.targetHubIds),
    cities: valuesSql(s.targetCities),
    fleets: valuesSql(s.targetFleetIds),
    types: valuesSql(s.targetVehicleTypeIds),
    oems: valuesSql(s.targetOemIds),
    application: Prisma.sql`${s.application}::text`,
  });
}
export function storedTargetPredicate() {
  return matches({
    roles: Prisma.sql`m."targetRoles"`,
    hubs: Prisma.sql`m."targetHubIds"`,
    cities: Prisma.sql`m."targetCities"`,
    fleets: Prisma.sql`m."targetFleetIds"`,
    types: Prisma.sql`m."targetVehicleTypeIds"`,
    oems: Prisma.sql`m."targetOemIds"`,
    application: Prisma.sql`m.application`,
  });
}
/** Same visibility predicate for list/count/read and pre-dispatch checks; recipient alias n. */
export function inboxEligibility(
  clientId: string,
  userId?: string,
  application?: string,
) {
  return Prisma.sql`n."clientId"=${clientId} AND m."clientId"=n."clientId" AND u."clientId"=n."clientId"
  AND u.id=n."userId" ${userId ? Prisma.sql`AND u.id=${userId}` : Prisma.empty}
  AND u."isActive" AND u."deletedAt" IS NULL AND u.role <> 'SUPER_ADMIN'
  AND EXISTS (SELECT 1 FROM "Client" c WHERE c.id=u."clientId" AND c."isActive" AND c.status NOT IN ('DRAFT','SUSPENDED'))
  AND (m."scheduledFor" IS NULL OR m."scheduledFor"<=now())
  AND m."withdrawnAt" IS NULL AND (m."visibilityExpiresAt" IS NULL OR m."visibilityExpiresAt">now())
  ${application ? Prisma.sql`AND (m.application IS NULL OR m.application=${application}) AND u.role::text=ANY(${valuesSql(applicationRoles[application] ?? [])})` : Prisma.empty}
  AND (m."visibilityPolicy"='PERSONAL' OR (m."visibilityPolicy" IN ('GENERAL','OPERATIONAL') AND ${storedTargetPredicate()}))`;
}
