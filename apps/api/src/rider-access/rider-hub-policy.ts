import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';

/** Operates on live client-filtered tables or the home API's historical CTEs. */
export function riderHubExpression(
  userId: Prisma.Sql = Prisma.raw('r."userId"'),
  riderId: Prisma.Sql = Prisma.raw('r.id'),
  clientId: Prisma.Sql = Prisma.raw('r."clientId"'),
) {
  return Prisma.sql`COALESCE(
    (SELECT uh."hubId" FROM "UserHub" uh WHERE uh."userId" = ${userId} AND uh."clientId" = ${clientId}
      ORDER BY uh."isPrimary" DESC, uh."hubId" ASC LIMIT 1),
    (SELECT COALESCE(f."homeHubId", f."currentHubId") FROM "Allocation" a
      JOIN "Fleet" f ON f.id = a."fleetId" AND f."clientId" = ${clientId}
      WHERE a."riderId" = ${riderId} AND a."clientId" = ${clientId}
      ORDER BY a."createdAt" DESC, a.id DESC LIMIT 1)
  )`;
}

/** MVP: a missing association is a shared queue, never an all-client authorization bypass. */
export function visibleRiderHub(hubIds: string[]) {
  return hubIds.length
    ? Prisma.sql`(r."attributedHubId" IS NULL OR r."attributedHubId" IN (${Prisma.join(hubIds)}))`
    : Prisma.sql`FALSE`;
}

export async function fleetManagerVisibleSubjects(
  db: PrismaService,
  clientId: string,
  userId: string,
) {
  const hubs = await db.userHub.findMany({
    where: {
      clientId,
      userId,
      hub: { clientId, status: 'ACTIVE', deletedAt: null },
    },
    select: { hubId: true },
  });
  if (!hubs.length)
    return { riderIds: [] as string[], userIds: [] as string[] };
  const rows = await db.$queryRaw<
    { riderId: string | null; userId: string | null }[]
  >(Prisma.sql`
    WITH subjects AS (
      SELECT r.id AS "riderId", r."userId", ${riderHubExpression()} AS "attributedHubId"
      FROM "Rider" r LEFT JOIN "User" u ON u.id = r."userId" AND u."clientId" = ${clientId}
      WHERE r."clientId" = ${clientId} AND r."deletedAt" IS NULL
        AND (r."userId" IS NULL OR (u."isActive" AND u."deletedAt" IS NULL))
      UNION ALL
      SELECT NULL::text, u.id, ${riderHubExpression(Prisma.raw('u.id'), Prisma.sql`NULL::text`, Prisma.raw('u."clientId"'))}
      FROM "User" u WHERE u."clientId" = ${clientId} AND u.role = 'RIDER' AND u."isActive" AND u."deletedAt" IS NULL
        AND NOT EXISTS (SELECT 1 FROM "Rider" existing WHERE existing."userId" = u.id)
    ) SELECT r."riderId", r."userId" FROM subjects r WHERE ${visibleRiderHub(hubs.map((hub) => hub.hubId))}
  `);
  return {
    riderIds: rows.flatMap((row) => (row.riderId ? [row.riderId] : [])),
    userIds: rows.flatMap((row) => (row.userId ? [row.userId] : [])),
  };
}
