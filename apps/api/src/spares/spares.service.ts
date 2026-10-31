import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  type ReturnPenaltyPrice,
  type SparePartMaster,
} from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import {
  createMasterSchema,
  money,
  penaltyMoney,
  pageSchema,
  parse,
  patchMasterSchema,
  reason,
  referenceFields,
} from './spares.policy.js';
import {
  copyActiveSpareMasters,
  recordSpareRevision,
  referenceSnapshot,
} from './spares-copy.js';
const clientPatch = z
  .object({
    expectedVersion: z.number().int().min(1),
    reason,
    penaltyAmount: penaltyMoney.nullable().optional(),
    evidenceRequired: z.boolean().optional(),
    isActive: z.boolean().optional(),
    name: referenceFields.name.optional(),
    baseRate: money.optional(),
    gstPercent: referenceFields.gstPercent.optional(),
    hsnCode: referenceFields.hsnCode.optional(),
    unit: referenceFields.unit.optional(),
    vehicleTypeIds: referenceFields.vehicleTypeIds.optional(),
  })
  .strict();
@Injectable()
export class SparesService {
  constructor(private readonly db: PrismaService) {}
  async bulkCreate(actor: AuthUser, input: unknown, clientId?: string) {
    this.admin(actor, !clientId);
    const body = parse(z.object({
      filename: z.string().trim().min(1).max(200),
      rows: z.array(z.record(z.string(), z.union([
        z.string().max(500), z.boolean(), z.array(z.string().max(100)).max(100), z.null(),
      ]))).min(1).max(100),
    }).strict(), input);
    const failures: { row: number; code: string; message: string; record: typeof body.rows[number] }[] = [];
    const job = await this.db.auditLog.create({ data: {
      clientId: clientId ?? null, actorId: actor.id,
      action: 'SPARES_BULK_IMPORT', entityType: 'SPARE_IMPORT',
      newData: { filename: body.filename, status: 'PROCESSING', totalRows: body.rows.length },
    } });
    let passedRows = 0;
    for (const [index, row] of body.rows.entries()) {
      try {
        if (clientId) await this.createClientSpare(clientId, actor, row);
        else await this.createMaster(actor, row);
        passedRows++;
      } catch (error) {
        if (!(error instanceof HttpException) || error.getStatus() >= 500) {
          await this.db.auditLog.update({ where: { id: job.id }, data: { newData: {
            filename: body.filename, status: 'INTERRUPTED', totalRows: body.rows.length,
            passedRows, failedRows: failures.length, failures,
          } } });
          throw error;
        }
        failures.push({ row: index + 2, code: String(row.code ?? ''), message: error.message, record: row });
      }
    }
    const result = {
      filename: body.filename, totalRows: body.rows.length, passedRows,
      failedRows: failures.length, failures,
      status: failures.length ? passedRows ? 'PARTIAL_PASS' : 'FAIL' : 'PASS',
    };
    await this.db.auditLog.update({ where: { id: job.id }, data: { newData: result } });
    return { ...result, id: job.id.toString(), createdAt: job.createdAt };
  }
  async importHistory(actor: AuthUser, clientId?: string) {
    this.admin(actor, !clientId);
    const jobs = await this.db.auditLog.findMany({
      where: { clientId: clientId ?? null, action: 'SPARES_BULK_IMPORT', entityType: 'SPARE_IMPORT' },
      orderBy: { createdAt: 'desc' }, take: 100,
    });
    return jobs.map((job) => {
      const data = job.newData as Record<string, Prisma.JsonValue>;
      return { id: job.id.toString(), createdAt: job.createdAt, fileName: data.filename,
        status: data.status, totalRows: data.totalRows, passedRows: data.passedRows ?? 0,
        failedRows: data.failedRows ?? 0, jobId: job.id.toString() };
    });
  }
  async importFailures(actor: AuthUser, id: string, clientId?: string) {
    this.admin(actor, !clientId);
    if (!/^\d{1,19}$/.test(id) || BigInt(id) > 9223372036854775807n)
      throw new BadRequestException('Invalid import identifier.');
    const job = await this.db.auditLog.findFirst({ where: {
      id: BigInt(id), clientId: clientId ?? null, action: 'SPARES_BULK_IMPORT', entityType: 'SPARE_IMPORT',
    } });
    if (!job) throw new NotFoundException('Spare import not found.');
    return (job.newData as Record<string, Prisma.JsonValue>).failures ?? [];
  }
  private admin(actor: AuthUser, platform = false) {
    if (!actor.roles.includes(platform ? 'SUPER_ADMIN' : 'CLIENT_ADMIN'))
      throw new ForbiddenException('Administrator permission is required.');
  }
  private async types(tx: Prisma.TransactionClient, ids: string[]) {
    if (
      new Set(ids).size !== ids.length ||
      (await tx.vehicleType.count({ where: { id: { in: ids }, status: 'ACTIVE' } })) !==
        ids.length
    )
      throw new BadRequestException('Select valid, distinct vehicle types.');
  }
  private async clientLock(tx: Prisma.TransactionClient, clientId: string) {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "Client" WHERE id=${clientId} FOR UPDATE`;
    if (!rows.length) throw new NotFoundException('Client not found.');
  }
  private view(
    row: ReturnPenaltyPrice & { masterSpare?: SparePartMaster | null },
  ) {
    return {
      ...row,
      origin: row.isSpare
        ? row.masterSpareId
          ? 'MASTER'
          : 'CLIENT'
        : 'NON_SPARE',
      name: row.name ?? row.description,
      penaltyAmount: row.penaltyConfigured ? row.amount.toFixed(2) : null,
      version: row.configurationVersion,
      masterUpdateAvailable:
        !!row.masterSpare && row.sourceVersion !== row.masterSpare.version,
      masterInactive: row.masterSpare?.isActive === false,
      allowedFindingTypes: row.isSpare
        ? ['DAMAGE', 'MISSING_ITEM']
        : [row.category],
    };
  }
  async masters(actor: AuthUser, input: unknown) {
    this.admin(actor, true);
    const q = parse(pageSchema, input);
    const where: Prisma.SparePartMasterWhereInput = {
      ...(q.status === 'ACTIVE'
        ? { isActive: true }
        : q.status === 'INACTIVE'
          ? { isActive: false }
          : {}),
      ...(q.search
        ? {
            OR: ['name', 'code', 'hsnCode'].map((k) => ({
              [k]: { contains: q.search, mode: 'insensitive' },
            })),
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.sparePartMaster.findMany({
        where,
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.db.sparePartMaster.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }
  async createMaster(actor: AuthUser, input: unknown) {
    this.admin(actor, true);
    const body = parse(createMasterSchema, input);
    return this.db.$transaction(async (tx) => {
      await this.types(tx, body.vehicleTypeIds);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`spare-master:${body.code}`}))`;
      if (await tx.sparePartMaster.findUnique({ where: { code: body.code } }))
        throw new ConflictException('Part code already exists.');
      const row = await tx.sparePartMaster.create({
        data: { ...body, createdById: actor.id },
      });
      await recordSpareRevision(tx, row, actor.id, 'Master spare created.');
      return row;
    });
  }
  async updateMaster(actor: AuthUser, id: string, input: unknown) {
    this.admin(actor, true);
    const {
      expectedVersion,
      reason: why,
      ...body
    } = parse(patchMasterSchema, input);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "SparePartMaster" WHERE id=${id} FOR UPDATE`;
      const old = await tx.sparePartMaster.findUnique({ where: { id } });
      if (!old) throw new NotFoundException('Master spare not found.');
      if (old.version !== expectedVersion)
        throw new ConflictException(
          'Master spare changed. Reload before saving.',
        );
      if (body.vehicleTypeIds) await this.types(tx, body.vehicleTypeIds);
      const row = await tx.sparePartMaster.update({
        where: { id },
        data: { ...body, version: { increment: 1 }, updatedById: actor.id },
      });
      await recordSpareRevision(tx, row, actor.id, why);
      return row;
    });
  }
  async list(clientId: string, actor: AuthUser, input: unknown) {
    this.admin(actor);
    const q = parse(pageSchema, input);
    const where: Prisma.ReturnPenaltyPriceWhereInput = {
      clientId,
      ...(q.status === 'ACTIVE'
        ? { isActive: true, penaltyConfigured: true }
        : q.status === 'INACTIVE'
          ? { isActive: false }
          : q.status === 'UNCONFIGURED'
            ? { penaltyConfigured: false }
            : {}),
      ...(q.origin === 'MASTER'
        ? { isSpare: true, masterSpareId: { not: null } }
        : q.origin === 'CLIENT'
          ? { isSpare: true, masterSpareId: null }
          : q.origin === 'NON_SPARE'
            ? { isSpare: false }
            : {}),
      ...(q.search
        ? {
            OR: ['name', 'description', 'code', 'hsnCode'].map((k) => ({
              [k]: { contains: q.search, mode: 'insensitive' },
            })),
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.returnPenaltyPrice.findMany({
        where,
        include: { masterSpare: true },
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.db.returnPenaltyPrice.count({ where }),
    ]);
    return {
      items: items.map((r) => this.view(r)),
      total,
      page: q.page,
      limit: q.limit,
    };
  }
  async createClientSpare(clientId: string, actor: AuthUser, input: unknown) {
    this.admin(actor);
    const body = parse(
      createMasterSchema.omit({ isActive: true }).extend({
        penaltyAmount: penaltyMoney.nullable().default(null),
        evidenceRequired: z.boolean().default(true),
        isActive: z.boolean().default(false),
      }),
      input,
    );
    return this.db.$transaction(async (tx) => {
      await this.clientLock(tx, clientId);
      await this.types(tx, body.vehicleTypeIds);
      if (
        await tx.returnPenaltyPrice.findUnique({
          where: { clientId_code: { clientId, code: body.code } },
        })
      )
        throw new ConflictException(
          'Part code is already used by this client.',
        );
      const { penaltyAmount, ...fields } = body;
      if (body.isActive && penaltyAmount === null)
        throw new BadRequestException(
          'Configure the penalty before enabling it.',
        );
      const row = await tx.returnPenaltyPrice.create({
        data: {
          ...fields,
          clientId,
          isSpare: true,
          category: 'DAMAGE',
          description: body.name,
          currency: 'INR',
          amount: penaltyAmount ?? '0',
          penaltyConfigured: penaltyAmount !== null,
          createdById: actor.id,
        },
      });
      await recordSpareRevision(tx, row, actor.id, 'Client spare created.');
      return this.view(row);
    });
  }
  async updateClient(
    clientId: string,
    actor: AuthUser,
    id: string,
    input: unknown,
  ) {
    this.admin(actor);
    const {
      expectedVersion,
      reason: why,
      penaltyAmount,
      ...fields
    } = parse(clientPatch, input);
    return this.db.$transaction(async (tx) => {
      await this.clientLock(tx, clientId);
      const old = await tx.returnPenaltyPrice.findFirst({
        where: { clientId, id },
      });
      if (!old) throw new NotFoundException('Client penalty not found.');
      if (old.configurationVersion !== expectedVersion)
        throw new ConflictException(
          'Penalty settings changed. Reload before saving.',
        );
      const metadata = [
        'name',
        'baseRate',
        'gstPercent',
        'hsnCode',
        'unit',
        'vehicleTypeIds',
      ] as const;
      if (
        (old.masterSpareId || !old.isSpare) &&
        metadata.some((k) => fields[k] !== undefined)
      )
        throw new BadRequestException(
          'Reference details can only be edited on client-created spares.',
        );
      if (fields.vehicleTypeIds) await this.types(tx, fields.vehicleTypeIds);
      const configured =
        penaltyAmount === undefined
          ? old.penaltyConfigured
          : penaltyAmount !== null;
      const enabled = fields.isActive ?? old.isActive;
      if (enabled && !configured)
        throw new BadRequestException(
          'Configure the penalty before enabling it.',
        );
      const row = await tx.returnPenaltyPrice.update({
        where: { id },
        data: {
          ...fields,
          ...(fields.name ? { description: fields.name } : {}),
          ...(penaltyAmount === undefined
            ? {}
            : { amount: penaltyAmount ?? '0', penaltyConfigured: configured }),
          configurationVersion: { increment: 1 },
          updatedById: actor.id,
        },
      });
      await recordSpareRevision(tx, row, actor.id, why);
      return this.view(row);
    });
  }
  async importMissing(clientId: string, actor: AuthUser) {
    this.admin(actor);
    return this.db.$transaction(
      async (tx) => {
        await this.clientLock(tx, clientId);
        return copyActiveSpareMasters(tx, clientId, actor.id);
      },
      { timeout: 30000 },
    );
  }
  async preview(clientId: string, actor: AuthUser) {
    this.admin(actor);
    const copies = await this.db.returnPenaltyPrice.findMany({
      where: { clientId, masterSpareId: { not: null } },
      include: { masterSpare: true },
      orderBy: { code: 'asc' },
    });
    return copies
      .filter((r) => r.masterSpare && r.sourceVersion !== r.masterSpare.version)
      .map((r) => ({
        priceId: r.id,
        code: r.code,
        expectedVersion: r.configurationVersion,
        sourceVersion: r.sourceVersion,
        masterVersion: r.masterSpare!.version,
        masterActive: r.masterSpare!.isActive,
        before: {
          name: r.name,
          baseRate: r.baseRate,
          gstPercent: r.gstPercent,
          hsnCode: r.hsnCode,
          unit: r.unit,
          vehicleTypeIds: r.vehicleTypeIds,
        },
        after: referenceSnapshot(r.masterSpare!),
      }));
  }
  async apply(clientId: string, actor: AuthUser, input: unknown) {
    this.admin(actor);
    const b = parse(
      z
        .object({
          reason,
          items: z
            .array(
              z
                .object({
                  priceId: z.string().uuid(),
                  expectedVersion: z.number().int().min(1),
                  masterVersion: z.number().int().min(1),
                })
                .strict(),
            )
            .min(1)
            .max(100),
        })
        .strict(),
      input,
    );
    if (new Set(b.items.map((i) => i.priceId)).size !== b.items.length)
      throw new BadRequestException('Duplicate update selection.');
    return this.db.$transaction(
      async (tx) => {
        await this.clientLock(tx, clientId);
        for (const item of [...b.items].sort((a, b) =>
          a.priceId.localeCompare(b.priceId),
        )) {
          const row = await tx.returnPenaltyPrice.findFirst({
            where: { clientId, id: item.priceId },
            include: { masterSpare: true },
          });
          if (!row?.masterSpare)
            throw new NotFoundException('Linked client spare not found.');
          await tx.$queryRaw`SELECT id FROM "SparePartMaster" WHERE id=${row.masterSpare.id} FOR SHARE`;
          const master = await tx.sparePartMaster.findUniqueOrThrow({
            where: { id: row.masterSpare.id },
          });
          if (
            row.configurationVersion !== item.expectedVersion ||
            master.version !== item.masterVersion
          )
            throw new ConflictException(
              'Preview is stale. Review the updates again.',
            );
          const updated = await tx.returnPenaltyPrice.update({
            where: { id: row.id },
            data: {
              ...referenceSnapshot(master),
              description: master.name,
              sourceVersion: master.version,
              configurationVersion: { increment: 1 },
              updatedById: actor.id,
            },
          });
          await recordSpareRevision(tx, updated, actor.id, b.reason);
        }
        return { updated: b.items.length };
      },
      { timeout: 30000 },
    );
  }
  async history(actor: AuthUser, id: string, clientId?: string) {
    this.admin(actor, !clientId);
    if (clientId) {
      if (
        !(await this.db.returnPenaltyPrice.findFirst({
          where: { id, clientId },
        }))
      )
        throw new NotFoundException('Client spare not found.');
    } else if (!(await this.db.sparePartMaster.findUnique({ where: { id } })))
      throw new NotFoundException('Master spare not found.');
    return this.db.spareCatalogueRevision.findMany({
      where: clientId ? { priceId: id } : { masterSpareId: id },
      orderBy: { version: 'desc' },
    });
  }
  async catalogue(clientId: string, actor: AuthUser, input: unknown) {
    const q = parse(
      z
        .object({
          page: z.coerce.number().int().min(1).max(100000).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(25),
          search: z.string().trim().max(100).optional(),
          submissionId: z.string().uuid().optional(),
          vehicleTypeId: z.string().uuid().optional(),
        })
        .strict(),
      input,
    );
    let type = q.vehicleTypeId;
    if (q.submissionId) {
      const sub = await this.db.vehicleSubmission.findFirst({
        where: { clientId, id: q.submissionId },
      });
      if (!sub) throw new NotFoundException('Submission not found.');
      if (
        actor.roles.includes('FLEET_MANAGER') &&
        !(await this.db.userHub.findFirst({
          where: { clientId, userId: actor.id, hubId: sub.hubId },
        }))
      )
        throw new ForbiddenException(
          'Submission is outside your assigned hubs.',
        );
      const fleet = await this.db.fleet.findFirstOrThrow({
        where: { id: sub.fleetId, clientId },
        select: { vehicleTypeId: true },
      });
      type = fleet.vehicleTypeId;
    }
    const where: Prisma.ReturnPenaltyPriceWhereInput = {
      clientId,
      isActive: true,
      penaltyConfigured: true,
      ...(type
        ? {
            OR: [
              { vehicleTypeIds: { isEmpty: true } },
              { vehicleTypeIds: { has: type } },
            ],
          }
        : {}),
      ...(q.search
        ? {
            AND: [
              {
                OR: ['name', 'description', 'code'].map((k) => ({
                  [k]: { contains: q.search, mode: 'insensitive' },
                })),
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.returnPenaltyPrice.findMany({
        where,
        include: { masterSpare: true },
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.db.returnPenaltyPrice.count({ where }),
    ]);
    return {
      data: rows.map((row) => this.view(row)),
      meta: {
        page: q.page,
        limit: q.limit,
        total,
        totalPages: Math.ceil(total / q.limit),
      },
    };
  }
}
