import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type FleetPreparation } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../media/storage/storage-provider.interface.js';
import {
  defaultPolicy,
  defaultStages,
  validateStages,
  modeSchema,
  parse,
  policySchema,
  reasonSchema,
  resultSchema,
  type ReadinessPolicy,
} from './readiness-policy.js';

type Tx = Prisma.TransactionClient;
const closed = ['APPROVED', 'INVALIDATED', 'CANCELLED'];
const actionableRoles = [
  'CLIENT_ADMIN',
  'OPERATIONS_MANAGER',
  'FLEET_MANAGER',
  'ADVISOR',
  'RFD_MANAGER',
  'QC_MANAGER',
];
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    hubId: z.string().uuid().optional(),
    status: z
      .enum([
        'PENDING',
        'IN_PROGRESS',
        'AWAITING_QC',
        'REWORK_REQUIRED',
        'APPROVED',
        'INVALIDATED',
        'CANCELLED',
      ])
      .optional(),
    search: z.string().trim().max(100).optional(),
    assignedToId: z.string().uuid().optional(),
  })
  .strict();

@Injectable()
export class FleetReadinessService {
  constructor(
    private readonly db: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}
  all(actor: AuthUser) {
    return actor.roles.some((role) =>
      ['CLIENT_ADMIN', 'OPERATIONS_MANAGER'].includes(role),
    );
  }
  private admin(actor: AuthUser) {
    if (!actor.roles.includes('CLIENT_ADMIN'))
      throw new ForbiddenException('Client Admin permission is required.');
  }
  async hubs(
    tx: Tx,
    clientId: string,
    actor: AuthUser,
    capability?: 'canPrepare' | 'canReview',
  ) {
    const grants = await tx.fleetReadinessStaff.findMany({
      where: {
        clientId,
        userId: actor.id,
        ...(capability ? { [capability]: true } : {}),
      },
    });
    const hubs = await tx.hub.findMany({
      where: {
        clientId,
        id: { in: grants.map((row) => row.hubId) },
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true },
    });
    return hubs.map((row) => row.id);
  }
  async access(
    tx: Tx,
    clientId: string,
    actor: AuthUser,
    hubId: string,
    capability?: 'canPrepare' | 'canReview',
  ) {
    const activeHub = await tx.hub.findFirst({
      where: { id: hubId, clientId, status: 'ACTIVE', deletedAt: null },
    });
    if (!activeHub) throw new NotFoundException('Active hub not found.');
    if (!capability && this.all(actor)) return;
    if (
      !capability &&
      actor.roles.includes('FLEET_MANAGER') &&
      (await tx.userHub.findFirst({
        where: { clientId, userId: actor.id, hubId },
      }))
    )
      return;
    if (!(await this.hubs(tx, clientId, actor, capability)).includes(hubId))
      throw new ForbiddenException(
        'This action requires readiness permission in the scooter’s current hub.',
      );
  }
  async event(
    tx: Tx,
    p: FleetPreparation,
    actor: AuthUser,
    action: string,
    data: unknown = {},
  ) {
    await tx.fleetPreparationEvent.create({
      data: {
        clientId: p.clientId,
        preparationId: p.id,
        actorId: actor.id,
        action,
        data: json(data),
      },
    });
  }
  async fleet(tx: Tx, clientId: string, id: string) {
    const row = await tx.fleet.findFirst({
      where: { id, clientId, deletedAt: null },
      include: {
        batteryHistory: {
          where: { removedAt: null },
          include: { battery: true },
          orderBy: { batteryId: 'asc' },
        },
        controllerHistory: {
          where: { removedAt: null },
          include: { controller: true },
          orderBy: { controllerId: 'asc' },
        },
        iotDevice: true,
        currentHub: true,
      },
    });
    if (!row) throw new NotFoundException('Scooter not found.');
    return row;
  }
  snapshot(f: Awaited<ReturnType<FleetReadinessService['fleet']>>) {
    return {
      hubId: f.currentHubId,
      batteries: f.batteryHistory.map((row) => ({
        id: row.batteryId,
        serial: row.battery.serialNumber,
        slot: row.batterySlot,
        installationId: row.id,
      })),
      controllers: f.controllerHistory.map((row) => ({
        id: row.controllerId,
        serial: row.controller.controllerNumber,
        installationId: row.id,
      })),
      iot: f.iotDevice
        ? { id: f.iotDevice.id, serial: f.iotDevice.deviceNumber }
        : null,
    };
  }
  private slots(
    policy: ReadinessPolicy,
    snapshot: ReturnType<FleetReadinessService['snapshot']>,
  ) {
    return [
      ...policy.photoTypes,
      ...snapshot.batteries.flatMap((b) => [
        `BATTERY_${b.id}_INSTALLATION`,
        `BATTERY_${b.id}_LABEL`,
      ]),
      ...snapshot.controllers.flatMap((c) => [
        `CONTROLLER_${c.id}_INSTALLATION`,
        `CONTROLLER_${c.id}_LABEL`,
      ]),
      ...(policy.iotRequired && snapshot.iot
        ? ['IOT_INSTALLATION', 'IOT_LABEL']
        : []),
    ];
  }
  async policy(clientId: string, tx: Tx = this.db) {
    const client = await tx.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { fleetOperatingMode: true },
    });
    const policy = await tx.fleetReadinessPolicy.findFirst({
      where: { clientId },
      orderBy: { version: 'desc' },
    });
    return {
      installationStageTemplates: defaultStages,
      operatingMode: client.fleetOperatingMode,
      version: policy?.version ?? 0,
      configuration: policy
        ? parse(policySchema, policy.configuration)
        : defaultPolicy,
    };
  }
  async preview(
    clientId: string,
    actor: AuthUser,
    input: unknown,
    tx: Tx = this.db,
  ) {
    this.admin(actor);
    const { operatingMode, configuration } = parse(
      z
        .object({
          operatingMode: modeSchema,
          configuration: policySchema.optional(),
        })
        .strict(),
      input,
    );
    if (configuration) validateStages(configuration.stages);
    const current = await this.policy(clientId, tx);
    const inProgressAllocations = await tx.allocation.count({
      where: {
        clientId,
        status: {
          in: [
            'INITIATED',
            'INSPECTION_PENDING',
            'OTP_PENDING',
            'DEALLOCATION_INITIATED',
          ],
        },
      },
    });
    const openPreparations = await tx.fleetPreparation.count({
      where: { clientId, status: { notIn: closed } },
    });
    const unallocated = await tx.fleet.count({
      where: {
        clientId,
        deletedAt: null,
        allocations: {
          none: { status: { notIn: ['COMPLETED', 'CANCELLED'] } },
        },
      },
    });
    const activeAllocations = await tx.allocation.count({
      where: { clientId, status: 'ACTIVE' },
    });
    const changed = current.operatingMode !== operatingMode;
    return {
      currentMode: current.operatingMode,
      proposedMode: operatingMode,
      proposedStages: (configuration ?? current.configuration).stages.map(
        (s) => ({
          code: s.code,
          name: s.name,
          dependencies: s.dependencies,
          verificationRequired: s.verificationRequired,
        }),
      ),
      policyEffect:
        'New stage definitions apply to new cycles. Existing cycles keep their frozen workflow version.',
      inProgressAllocations,
      openPreparations,
      unallocatedScooters: unallocated,
      activeAllocations,
      blocked: changed && (inProgressAllocations > 0 || openPreparations > 0),
      message:
        'Active handovers, submissions, and open preparations must finish before changing mode. Allocated scooters stay with their riders.',
    };
  }
  async savePolicy(clientId: string, actor: AuthUser, input: unknown) {
    this.admin(actor);
    const body = parse(
      z
        .object({
          operatingMode: modeSchema,
          expectedVersion: z.number().int().min(0),
          reason: reasonSchema,
          configuration: policySchema,
        })
        .strict(),
      input,
    );
    validateStages(body.configuration.stages);
    if (
      body.operatingMode === 'STAGED_PREPARATION_QC' &&
      !body.configuration.stages.length
    )
      throw new BadRequestException(
        'Configure at least one installation stage.',
      );
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${clientId} FOR UPDATE`;
      for (const stage of body.configuration.stages) {
        if (
          stage.hubIds.length !==
          (await tx.hub.count({
            where: {
              id: { in: stage.hubIds },
              clientId,
              deletedAt: null,
              status: 'ACTIVE',
            },
          }))
        )
          throw new BadRequestException(
            'Stage includes an unknown or inactive hub.',
          );
        if (
          stage.vehicleTypeIds.length !==
          (await tx.vehicleType.count({
            where: { id: { in: stage.vehicleTypeIds } },
          }))
        )
          throw new BadRequestException(
            'Stage includes an unknown vehicle type.',
          );
      }
      const current = await this.policy(clientId, tx);
      if (current.version !== body.expectedVersion)
        throw new ConflictException('Policy changed. Reload before saving.');
      const preview = await this.preview(
        clientId,
        actor,
        { operatingMode: body.operatingMode },
        tx,
      );
      if (preview.blocked) throw new ConflictException(preview);
      const policy = await tx.fleetReadinessPolicy.create({
        data: {
          clientId,
          version: current.version + 1,
          configuration: json(body.configuration),
          reason: body.reason,
          createdById: actor.id,
        },
      });
      if (
        ['PREPARATION_QC', 'STAGED_PREPARATION_QC'].includes(
          body.operatingMode,
        ) &&
        current.operatingMode !== body.operatingMode
      ) {
        await tx.fleet.updateMany({
          where: { clientId, status: 'AVAILABLE', allocationEnabled: false },
          data: { allocationBlockedByAdmin: true },
        });
      }
      await tx.client.update({
        where: { id: clientId },
        data: { fleetOperatingMode: body.operatingMode },
      });
      if (current.operatingMode !== body.operatingMode) {
        const approved = await tx.fleetPreparation.findMany({
          where: { clientId, status: 'APPROVED' },
        });
        for (const p of approved)
          await this.event(tx, p, actor, 'INVALIDATED', {
            reason: 'Client operating mode changed.',
          });
        await tx.fleetPreparation.updateMany({
          where: { clientId, status: 'APPROVED' },
          data: {
            status: 'INVALIDATED',
            invalidationReason: 'Client operating mode changed.',
          },
        });
        // Clear approvals on every mode transition; never resurrect an earlier QC approval.
        await tx.fleet.updateMany({
          where: { clientId, deletedAt: null },
          data: { readinessApprovedPreparationId: null },
        });
        if (
          ['PREPARATION_QC', 'STAGED_PREPARATION_QC'].includes(
            body.operatingMode,
          )
        )
          await tx.fleet.updateMany({
            where: { clientId, status: 'AVAILABLE', deletedAt: null },
            data: { status: 'INSPECTION_PENDING' },
          });
      }
      await tx.auditLog.create({
        data: {
          clientId,
          actorId: actor.id,
          action: 'FLEET_READINESS_POLICY_UPDATED',
          entityType: 'CLIENT',
          entityId: clientId,
          newData: json({
            version: policy.version,
            operatingMode: body.operatingMode,
            reason: body.reason,
          }),
        },
      });
      return {
        installationStageTemplates: defaultStages,
        operatingMode: body.operatingMode,
        version: policy.version,
        configuration: body.configuration,
      };
    });
  }
  async staff(clientId: string, actor: AuthUser) {
    if (!this.all(actor))
      throw new ForbiddenException('Staff management access is required.');
    const [users, hubs, assignments] = await Promise.all([
      this.db.user.findMany({
        where: {
          clientId,
          deletedAt: null,
          role: { in: actionableRoles as never },
        },
        select: {
          id: true,
          name: true,
          mobile: true,
          role: true,
          isActive: true,
        },
      }),
      this.db.hub.findMany({
        where: { clientId, deletedAt: null, status: 'ACTIVE' },
        select: { id: true, name: true },
      }),
      this.db.fleetReadinessStaff.findMany({ where: { clientId } }),
    ]);
    return { users, hubs, assignments };
  }
  async createStaff(clientId: string, actor: AuthUser, input: unknown) {
    this.admin(actor);
    const b = parse(
      z
        .object({
          name: z.string().trim().min(1).max(100),
          mobile: z.string().regex(/^\+91[6-9]\d{9}$/),
          role: z.enum(['ADVISOR', 'RFD_MANAGER', 'QC_MANAGER']),
        })
        .strict(),
      input,
    );
    const client = await this.db.client.findUniqueOrThrow({
      where: { id: clientId }, select: { fleetOperatingMode: true },
    });
    if (client.fleetOperatingMode === 'SIMPLE') {
      throw new ForbiddenException('Dedicated Advisors and QC Managers are unavailable in Simple mode. Client Admins and Fleet Managers perform these responsibilities.');
    }
    const exists = await this.db.user.findUnique({
      where: { clientId_mobile: { clientId, mobile: b.mobile } },
    });
    if (exists)
      throw new ConflictException(
        'This mobile already belongs to a user. Assign readiness permissions to that user instead.',
      );
    const user = await this.db.user.create({
      data: { ...b, clientId },
      select: { id: true, name: true, mobile: true, role: true },
    });
    await this.db.auditLog.create({
      data: {
        clientId,
        actorId: actor.id,
        action: 'READINESS_STAFF_CREATED',
        entityType: 'USER',
        entityId: user.id,
      },
    });
    return user;
  }
  async saveStaff(
    clientId: string,
    actor: AuthUser,
    userId: string,
    input: unknown,
  ) {
    this.admin(actor);
    const body = parse(
      z
        .object({
          assignments: z
            .array(
              z
                .object({
                  hubId: z.string().uuid(),
                  canPrepare: z.boolean(),
                  canReview: z.boolean(),
                  stageCodes: z
                    .array(z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/))
                    .max(20)
                    .default([]),
                  reviewStageCodes: z
                    .array(z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/))
                    .max(20)
                    .default([]),
                })
                .strict(),
            )
            .max(100),
        })
        .strict(),
      input,
    );
    if (
      new Set(body.assignments.map((a) => a.hubId)).size !==
      body.assignments.length
    )
      throw new BadRequestException('Duplicate hub assignment.');
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} AND "clientId" = ${clientId} FOR UPDATE`;
      const user = await tx.user.findFirst({
        where: {
          id: userId,
          clientId,
          deletedAt: null,
          isActive: true,
          role: { in: actionableRoles as never },
        },
      });
      if (!user)
        throw new NotFoundException('Active operations user not found.');
      if (['ADVISOR', 'RFD_MANAGER', 'QC_MANAGER'].includes(user.role)) {
        const client = await tx.client.findUniqueOrThrow({ where: { id: clientId }, select: { fleetOperatingMode: true } });
        if (client.fleetOperatingMode === 'SIMPLE') throw new ForbiddenException('Dedicated staff permissions are unavailable in Simple mode.');
      }
      for (const a of body.assignments)
        if (
          !(await tx.hub.findFirst({
            where: { id: a.hubId, clientId, deletedAt: null, status: 'ACTIVE' },
          }))
        )
          throw new NotFoundException('Active hub not found.');
      await tx.fleetReadinessStaff.deleteMany({ where: { clientId, userId } });
      await tx.fleetReadinessStaff.createMany({
        data: body.assignments
          .filter(
            (a) =>
              a.canPrepare ||
              a.canReview ||
              a.stageCodes.length ||
              a.reviewStageCodes.length,
          )
          .map((a) => ({ ...a, clientId, userId })),
      });
      await tx.auditLog.create({
        data: {
          clientId,
          actorId: actor.id,
          action: 'READINESS_PERMISSIONS_UPDATED',
          entityType: 'USER',
          entityId: userId,
          newData: json(body),
        },
      });
      return { userId, ...body };
    });
  }
  async list(clientId: string, actor: AuthUser, query: unknown, qc = false) {
    const q = parse(listSchema, query);
    const hubIds = this.all(actor)
      ? undefined
      : await this.hubs(this.db, clientId, actor);
    const where: Prisma.FleetPreparationWhereInput = {
      clientId,
      hubId: q.hubId
        ? hubIds && !hubIds.includes(q.hubId)
          ? '__denied__'
          : q.hubId
        : hubIds
          ? { in: hubIds }
          : undefined,
      ...(qc
        ? { status: q.status ?? 'AWAITING_QC' }
        : q.status
          ? { status: q.status }
          : {}),
      ...(q.assignedToId ? { assignedToId: q.assignedToId } : {}),
    };
    if (q.search)
      where.fleetId = {
        in: (
          await this.db.fleet.findMany({
            where: {
              clientId,
              OR: ['fleetCode', 'vehicleNumber', 'chassisNumber'].map(
                (field) => ({
                  [field]: { contains: q.search, mode: 'insensitive' },
                }),
              ),
            },
            select: { id: true },
          })
        ).map((row) => row.id),
      };
    const [rows, total] = await Promise.all([
      this.db.fleetPreparation.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      }),
      this.db.fleetPreparation.count({ where }),
    ]);
    const [fleets, users, hubs] = await Promise.all([
      this.db.fleet.findMany({
        where: { clientId, id: { in: rows.map((r) => r.fleetId) } },
        select: {
          id: true,
          fleetCode: true,
          vehicleNumber: true,
          chassisNumber: true,
          status: true,
          allocationEnabled: true,
        },
      }),
      this.db.user.findMany({
        where: {
          clientId,
          id: {
            in: rows.flatMap((r) => (r.assignedToId ? [r.assignedToId] : [])),
          },
        },
        select: { id: true, name: true },
      }),
      this.db.hub.findMany({
        where: { clientId, id: { in: rows.map((r) => r.hubId) } },
        select: { id: true, name: true },
      }),
    ]);
    return {
      items: rows.map((row) => ({
        ...row,
        fleet: fleets.find((f) => f.id === row.fleetId),
        assignee: users.find((u) => u.id === row.assignedToId),
        hub: hubs.find((h) => h.id === row.hubId),
      })),
      total,
      page: q.page,
      limit: q.limit,
    };
  }
  async summary(clientId: string, actor: AuthUser) {
    const hubs = this.all(actor)
      ? undefined
      : await this.hubs(this.db, clientId, actor);
    return this.db.fleetPreparation.groupBy({
      by: ['status'],
      where: { clientId, ...(hubs ? { hubId: { in: hubs } } : {}) },
      _count: { _all: true },
    });
  }
  async context(clientId: string, actor: AuthUser) {
    const [prepare, review] = await Promise.all([
      this.hubs(this.db, clientId, actor, 'canPrepare'),
      this.hubs(this.db, clientId, actor, 'canReview'),
    ]);
    const readable = await this.hubs(this.db, clientId, actor);
    const hubs = await this.db.hub.findMany({
      where: {
        clientId,
        deletedAt: null,
        status: 'ACTIVE',
        ...(!this.all(actor) ? { id: { in: readable } } : {}),
      },
      select: { id: true, name: true },
    });
    const grants = this.all(actor)
      ? await this.db.fleetReadinessStaff.findMany({
          where: { clientId, canPrepare: true },
        })
      : [];
    const preparers = this.all(actor)
      ? await this.db.user.findMany({
          where: {
            clientId,
            isActive: true,
            deletedAt: null,
            id: { in: grants.map((g) => g.userId) },
          },
          select: { id: true, name: true },
        })
      : [];
    return {
      hubs,
      vehicleTypes: await this.db.vehicleType.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prepareHubIds: prepare,
      reviewHubIds: review,
      preparers: preparers.map((user) => ({
        ...user,
        hubIds: grants.filter((g) => g.userId === user.id).map((g) => g.hubId),
      })),
      canManage: this.all(actor),
      isAdmin: actor.roles.includes('CLIENT_ADMIN'),
      userId: actor.id,
    };
  }
  async candidates(clientId: string, actor: AuthUser, input: unknown) {
    const q = parse(listSchema, input);
    const hubs = this.all(actor)
      ? undefined
      : await this.hubs(this.db, clientId, actor);
    const open = await this.db.fleetPreparation.findMany({
      where: { clientId, status: { notIn: closed } },
      select: { fleetId: true },
    });
    const where: Prisma.FleetWhereInput = {
      clientId,
      deletedAt: null,
      status: { in: ['IN_TRANSIT', 'INSPECTION_PENDING', 'AVAILABLE'] },
      readinessApprovedPreparationId: null,
      id: { notIn: open.map((p) => p.fleetId) },
      currentHubId: q.hubId
        ? hubs && !hubs.includes(q.hubId)
          ? '__denied__'
          : q.hubId
        : hubs
          ? { in: hubs }
          : { not: null },
      allocations: { none: { status: { notIn: ['COMPLETED', 'CANCELLED'] } } },
      ...(q.search
        ? {
            OR: ['fleetCode', 'vehicleNumber', 'chassisNumber'].map(
              (field) => ({
                [field]: { contains: q.search, mode: 'insensitive' },
              }),
            ),
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.fleet.findMany({
        where,
        include: { currentHub: { select: { id: true, name: true } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: q.limit,
        skip: (q.page - 1) * q.limit,
      }),
      this.db.fleet.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }
  private async locked(tx: Tx, clientId: string, id: string) {
    const initial = await tx.fleetPreparation.findFirst({
      where: { clientId, id },
    });
    if (!initial) throw new NotFoundException('Preparation not found.');
    await tx.$queryRaw`SELECT id FROM "Fleet" WHERE id = ${initial.fleetId} AND "clientId" = ${clientId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "FleetPreparation" WHERE id = ${id} AND "clientId" = ${clientId} FOR UPDATE`;
    return tx.fleetPreparation.findFirstOrThrow({ where: { clientId, id } });
  }
  private async editable(
    tx: Tx,
    clientId: string,
    actor: AuthUser,
    id: string,
    expectedRevision: number,
  ) {
    let p = await this.locked(tx, clientId, id);
    const fleet = await this.fleet(tx, clientId, p.fleetId);
    if (p.hubId !== fleet.currentHubId)
      throw new ConflictException(
        'The scooter moved hubs. Start a new preparation.',
      );
    await this.access(tx, clientId, actor, p.hubId, 'canPrepare');
    if (p.assignedToId !== actor.id)
      throw new ForbiddenException(
        'Only the assigned RFD staff can edit this preparation.',
      );
    if (p.currentRevision !== expectedRevision)
      throw new ConflictException('Revision changed. Reload before editing.');
    if (!['PENDING', 'IN_PROGRESS', 'REWORK_REQUIRED'].includes(p.status))
      throw new ConflictException('Preparation is not editable.');
    if (p.status === 'REWORK_REQUIRED') {
      p = await tx.fleetPreparation.update({
        where: { id },
        data: { currentRevision: { increment: 1 }, status: 'IN_PROGRESS' },
      });
      await tx.fleetPreparationRevision.create({
        data: { clientId, preparationId: id, revision: p.currentRevision },
      });
      await this.event(tx, p, actor, 'REWORK_STARTED');
    }
    const revision = await tx.fleetPreparationRevision.findUniqueOrThrow({
      where: {
        preparationId_revision: {
          preparationId: id,
          revision: p.currentRevision,
        },
      },
    });
    return { p, fleet, revision };
  }
  async start(clientId: string, actor: AuthUser, fleetId: string) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${clientId} FOR SHARE`;
      if (
        !['PREPARATION_QC', 'STAGED_PREPARATION_QC'].includes(
          (await this.policy(clientId, tx)).operatingMode,
        )
      )
        throw new ConflictException(
          'Enable Preparation + QC mode before starting preparation.',
        );
      await tx.$queryRaw`SELECT id FROM "Fleet" WHERE id = ${fleetId} AND "clientId" = ${clientId} FOR UPDATE`;
      const f = await this.fleet(tx, clientId, fleetId);
      if (!f.currentHubId)
        throw new BadRequestException('Assign a current hub first.');
      const startPolicy = await this.policy(clientId, tx);
      if (startPolicy.operatingMode === 'STAGED_PREPARATION_QC') {
        await this.access(tx, clientId, actor, f.currentHubId);
        const grant = await tx.fleetReadinessStaff.findUnique({
          where: {
            clientId_userId_hubId: {
              clientId,
              userId: actor.id,
              hubId: f.currentHubId,
            },
          },
        });
        if (!grant || (!grant.canPrepare && !grant.stageCodes.length))
          throw new ForbiddenException(
            'Preparation or installation permission is required.',
          );
      } else
        await this.access(tx, clientId, actor, f.currentHubId, 'canPrepare');
      if (!['IN_TRANSIT', 'AVAILABLE', 'INSPECTION_PENDING'].includes(f.status))
        throw new ConflictException(
          'Finish maintenance, submission, or allocation before preparation.',
        );
      if (
        await tx.allocation.count({
          where: {
            clientId,
            fleetId,
            status: { notIn: ['COMPLETED', 'CANCELLED'] },
          },
        })
      )
        throw new ConflictException('Scooter has an unfinished allocation.');
      const open = await tx.fleetPreparation.findFirst({
        where: { clientId, fleetId, status: { notIn: closed } },
      });
      if (open) return { id: open.id, existing: true };
      const policy = await this.policy(clientId, tx);
      const p = await tx.fleetPreparation.create({
        data: {
          clientId,
          fleetId,
          hubId: f.currentHubId,
          assignedToId: actor.id,
          createdById: actor.id,
          status: 'IN_PROGRESS',
          policySnapshot: json(policy),
          revisions: { create: { revision: 1 } },
        },
      });
      await tx.fleet.update({
        where: { id: fleetId },
        data: {
          readinessApprovedPreparationId: null,
          status: 'INSPECTION_PENDING',
        },
      });
      if (policy.operatingMode === 'STAGED_PREPARATION_QC') {
        const stages = policy.configuration.stages.filter(
          (stage) =>
            (!stage.hubIds.length || stage.hubIds.includes(f.currentHubId!)) &&
            (!stage.vehicleTypeIds.length ||
              stage.vehicleTypeIds.includes(f.vehicleTypeId)),
        );
        for (const stage of stages) {
          if (
            stage.dependencies.some(
              (code) => !stages.some((s) => s.code === code),
            )
          )
            throw new BadRequestException(
              'Applicable stage has an excluded prerequisite.',
            );
          await tx.fleetInstallationStage.create({
            data: {
              clientId,
              preparationId: p.id,
              code: stage.code,
              definition: json(stage),
              status: stage.dependencies.length ? 'WAITING' : 'READY',
            },
          });
        }
        if (!stages.length)
          throw new BadRequestException(
            'No installation stages apply to this scooter.',
          );
      }
      await this.event(tx, p, actor, 'PREPARATION_STARTED');
      return { id: p.id, existing: false };
    });
  }
  async detail(clientId: string, actor: AuthUser, id: string) {
    const p = await this.db.fleetPreparation.findFirst({
      where: { clientId, id },
      include: { stages: true, revisions: { orderBy: { revision: 'desc' } } },
    });
    if (!p) throw new NotFoundException('Preparation not found.');
    const fleet = await this.fleet(this.db, clientId, p.fleetId);
    await this.access(this.db, clientId, actor, p.hubId);
    if (fleet.currentHubId && fleet.currentHubId !== p.hubId)
      await this.access(this.db, clientId, actor, fleet.currentHubId);
    const current = p.revisions.find((r) => r.revision === p.currentRevision)!;
    const policy = parse(
      policySchema,
      (p.policySnapshot as { configuration: unknown }).configuration,
    );
    const components = current.componentSnapshot
      ? (current.componentSnapshot as unknown as ReturnType<
          FleetReadinessService['snapshot']
        >)
      : this.snapshot(fleet);
    const photos = await this.db.photo.findMany({
      where: {
        clientId,
        entityType: 'PREPARATION',
        entityId: { in: p.revisions.map((r) => r.id) },
        status: 'COMPLETE',
      },
      orderBy: { uploadedAt: 'asc' },
    });
    const [prepare, review] = await Promise.all([
      this.hubs(this.db, clientId, actor, 'canPrepare'),
      this.hubs(this.db, clientId, actor, 'canReview'),
    ]);
    const events = await this.db.fleetPreparationEvent.findMany({
      where: { clientId, preparationId: id },
      orderBy: { createdAt: 'asc' },
    });
    const contributed =
      p.createdById === actor.id ||
      p.assignedToId === actor.id ||
      current.submittedById === actor.id ||
      events.some(
        (e) =>
          e.actorId === actor.id &&
          [
            'DRAFT_SAVED',
            'PHOTO_COMPLETED',
            'REWORK_STARTED',
            'INSTALLATION_SAVE',
            'INSTALLATION_COMPONENTS',
            'INSTALLATION_PHOTO',
            'INSTALLATION_UPLOAD',
            'INSTALLATION_SUBMIT',
          ].includes(e.action),
      );
    return {
      ...p,
      fleet,
      current,
      configuration: policy,
      components,
      requiredPhotoTypes: this.slots(policy, components),
      photos,
      events,
      permissions: {
        canPrepare: prepare.includes(p.hubId) && p.assignedToId === actor.id,
        canReview:
          review.includes(p.hubId) &&
          (!policy.independentReview || !contributed),
        canAssign: this.all(actor),
      },
    };
  }
  async assign(clientId: string, actor: AuthUser, id: string, input: unknown) {
    if (!this.all(actor))
      throw new ForbiddenException(
        'Operations management permission is required.',
      );
    const b = parse(
      z
        .object({
          userId: z.string().uuid(),
          revision: z.number().int().min(1),
        })
        .strict(),
      input,
    );
    return this.db.$transaction(async (tx) => {
      const p = await this.locked(tx, clientId, id);
      if (
        closed.includes(p.status) ||
        p.status === 'AWAITING_QC' ||
        p.currentRevision !== b.revision
      )
        throw new ConflictException(
          'Preparation cannot be reassigned in this state.',
        );
      const grant = await tx.fleetReadinessStaff.findFirst({
        where: { clientId, userId: b.userId, hubId: p.hubId, canPrepare: true },
      });
      const user = await tx.user.findFirst({
        where: { id: b.userId, clientId, isActive: true, deletedAt: null },
      });
      if (!grant || !user)
        throw new BadRequestException(
          'Assignee requires active RFD permission in this hub.',
        );
      await tx.fleetPreparation.update({
        where: { id },
        data: { assignedToId: b.userId },
      });
      await this.event(tx, p, actor, 'ASSIGNED', { userId: b.userId });
      return { id };
    });
  }
  async save(clientId: string, actor: AuthUser, id: string, input: unknown) {
    const b = parse(
      z
        .object({
          revision: z.number().int().min(1),
          checklist: resultSchema,
          odometerKm: z.number().nonnegative().max(10000000),
        })
        .strict(),
      input,
    );
    return this.db.$transaction(async (tx) => {
      const { p, revision } = await this.editable(
        tx,
        clientId,
        actor,
        id,
        b.revision,
      );
      const policy = parse(
        policySchema,
        (p.policySnapshot as { configuration: unknown }).configuration,
      );
      if (
        Object.keys(b.checklist).some(
          (code) => !policy.items.some((item) => item.code === code),
        )
      )
        throw new BadRequestException('Unknown checklist item.');
      await tx.fleetPreparationRevision.update({
        where: { id: revision.id },
        data: { checklist: json({ ...b.checklist, odometerKm: b.odometerKm }) },
      });
      await tx.fleetPreparation.update({
        where: { id },
        data: { status: 'IN_PROGRESS' },
      });
      await this.event(tx, p, actor, 'DRAFT_SAVED', {
        revision: p.currentRevision,
      });
      return { id, revision: p.currentRevision };
    });
  }
  async upload(clientId: string, actor: AuthUser, id: string, input: unknown) {
    const b = parse(
      z
        .object({
          revision: z.number().int().min(1),
          photoType: z.string().min(1).max(100),
          mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
          fileName: z.string().min(1).max(255),
          sizeBytes: z
            .number()
            .int()
            .min(1)
            .max(5 * 1024 * 1024),
        })
        .strict(),
      input,
    );
    const ext =
      b.mimeType === 'image/jpeg'
        ? 'jpg'
        : b.mimeType === 'image/png'
          ? 'png'
          : 'webp';
    if (
      !b.fileName.toLowerCase().endsWith(`.${ext}`) &&
      !(ext === 'jpg' && b.fileName.toLowerCase().endsWith('.jpeg'))
    )
      throw new BadRequestException(
        'File extension must match the image type.',
      );
    const photo = await this.db.$transaction(async (tx) => {
      const { p, fleet, revision } = await this.editable(
        tx,
        clientId,
        actor,
        id,
        b.revision,
      );
      const policy = parse(
        policySchema,
        (p.policySnapshot as { configuration: unknown }).configuration,
      );
      if (!this.slots(policy, this.snapshot(fleet)).includes(b.photoType))
        throw new BadRequestException('Unknown preparation photo slot.');
      return tx.photo.create({
        data: {
          clientId,
          entityType: 'PREPARATION',
          entityId: revision.id,
          photoType: b.photoType,
          mimeType: b.mimeType,
          sizeBytes: b.sizeBytes,
          uploadedById: actor.id,
          objectKey: `clients/${clientId}/preparation/${revision.id}/${randomUUID()}.${ext}`,
        },
      });
    });
    return {
      photo,
      uploadUrl: await this.storage.createUploadUrl({
        objectKey: photo.objectKey,
        mimeType: photo.mimeType,
        sizeBytes: photo.sizeBytes,
      }),
    };
  }
  async completePhoto(
    clientId: string,
    actor: AuthUser,
    id: string,
    photoId: string,
    input: unknown,
  ) {
    const b = parse(
      z.object({ revision: z.number().int().min(1) }).strict(),
      input,
    );
    const photo = await this.db.photo.findFirst({
      where: { id: photoId, clientId, entityType: 'PREPARATION' },
    });
    if (!photo) throw new NotFoundException('Preparation photo not found.');
    const owner = await this.db.fleetPreparation.findFirst({
      where: { id, clientId },
    });
    if (!owner) throw new NotFoundException('Preparation not found.');
    await this.access(this.db, clientId, actor, owner.hubId, 'canPrepare');
    if (owner.assignedToId !== actor.id)
      throw new ForbiddenException(
        'Only the assigned RFD staff can complete preparation photos.',
      );
    if (
      owner.currentRevision !== b.revision ||
      !['PENDING', 'IN_PROGRESS'].includes(owner.status)
    )
      throw new ConflictException('Preparation is not editable.');
    const ownerRevision =
      await this.db.fleetPreparationRevision.findUniqueOrThrow({
        where: {
          preparationId_revision: { preparationId: id, revision: b.revision },
        },
      });
    if (photo.entityId !== ownerRevision.id)
      throw new ConflictException('Photo belongs to a different revision.');
    if (!['PENDING_UPLOAD', 'COMPLETE'].includes(photo.status))
      throw new ConflictException('Photo cannot be completed.');
    const sealedKey =
      photo.status === 'PENDING_UPLOAD'
        ? `clients/${clientId}/preparation/${photo.entityId}/sealed/${randomUUID()}.${photo.objectKey.split('.').pop()}`
        : photo.objectKey;
    if (photo.status === 'PENDING_UPLOAD')
      await this.storage.sealObject(photo.objectKey, sealedKey);
    await this.storage.assertObjectExists(sealedKey, {
      maxBytes: photo.sizeBytes,
    });
    return this.db.$transaction(async (tx) => {
      const { p, revision } = await this.editable(
        tx,
        clientId,
        actor,
        id,
        b.revision,
      );
      if (photo.entityId !== revision.id)
        throw new ConflictException('Photo belongs to a different revision.');
      const current = await tx.photo.findUniqueOrThrow({
        where: { id: photoId },
      });
      if (current.status === 'COMPLETE') return current;
      if (current.status !== 'PENDING_UPLOAD')
        throw new ConflictException('Photo cannot be completed.');
      await tx.photo.updateMany({
        where: {
          clientId,
          entityId: revision.id,
          entityType: 'PREPARATION',
          photoType: photo.photoType,
          status: 'COMPLETE',
        },
        data: { status: 'DELETED' },
      });
      const result = await tx.photo.update({
        where: { id: photoId },
        data: {
          status: 'COMPLETE',
          objectKey: sealedKey,
          uploadedAt: new Date(),
        },
      });
      await this.event(tx, p, actor, 'PHOTO_COMPLETED', {
        revision: p.currentRevision,
        photoId,
      });
      return result;
    });
  }
  async download(
    clientId: string,
    actor: AuthUser,
    id: string,
    photoId: string,
  ) {
    const detail = await this.detail(clientId, actor, id);
    const photo = detail.photos.find((p) => p.id === photoId);
    if (!photo) throw new NotFoundException('Preparation photo not found.');
    return { url: await this.storage.createDownloadUrl(photo.objectKey) };
  }
  async submit(clientId: string, actor: AuthUser, id: string, input: unknown) {
    const b = parse(
      z.object({ revision: z.number().int().min(1) }).strict(),
      input,
    );
    return this.db.$transaction(async (tx) => {
      const existing = await this.locked(tx, clientId, id);
      if (
        existing.status === 'AWAITING_QC' &&
        existing.currentRevision === b.revision
      ) {
        await this.access(tx, clientId, actor, existing.hubId, 'canPrepare');
        const submitted = await tx.fleetPreparationRevision.findUniqueOrThrow({
          where: {
            preparationId_revision: { preparationId: id, revision: b.revision },
          },
        });
        if (submitted.submittedById !== actor.id)
          throw new ForbiddenException(
            'Only the submitting staff can retry this submission.',
          );
        return { id, revision: b.revision };
      }
      const { p, fleet, revision } = await this.editable(
        tx,
        clientId,
        actor,
        id,
        b.revision,
      );
      const policy = parse(
        policySchema,
        (p.policySnapshot as { configuration: unknown }).configuration,
      );
      await this.requireStages(tx, p.id);
      const snapshot = this.snapshot(fleet);
      if (
        snapshot.batteries.length < policy.minBatteryCount ||
        (policy.requireController && !snapshot.controllers.length) ||
        (policy.iotRequired && !snapshot.iot)
      )
        throw new BadRequestException(
          'Required installed components are missing.',
        );
      const checklist = revision.checklist as Record<string, unknown>;
      const checks = parse(
        resultSchema,
        Object.fromEntries(
          Object.entries(checklist).filter(([key]) => key !== 'odometerKm'),
        ),
      );
      const missing = policy.items
        .filter((item) => {
          const check = checks[item.code];
          return (
            item.required &&
            (!check ||
              (check.result !== 'PASS' &&
                !(check.result === 'NA' && item.allowNA && check.notes.trim())))
          );
        })
        .map((item) => item.code);
      const failed = Object.entries(checks)
        .filter(
          ([code, c]) =>
            c.result === 'FAIL' ||
            (c.result === 'NA' &&
              (!c.notes.trim() ||
                !policy.items.find((item) => item.code === code)?.allowNA)),
        )
        .map(([key]) => key);
      if (
        missing.length ||
        failed.length ||
        typeof checklist.odometerKm !== 'number'
      )
        throw new BadRequestException({
          message:
            'Complete all applicable preparation checks and record the odometer.',
          missing,
          failed,
        });
      const photos = await tx.photo.findMany({
        where: {
          clientId,
          entityType: 'PREPARATION',
          entityId: revision.id,
          status: 'COMPLETE',
        },
      });
      const missingPhotos = this.slots(policy, snapshot).filter(
        (slot) => !photos.some((photo) => photo.photoType === slot),
      );
      if (missingPhotos.length)
        throw new BadRequestException({
          message: 'Required preparation photos are missing.',
          missing: missingPhotos,
        });
      await tx.fleetPreparationRevision.update({
        where: { id: revision.id },
        data: {
          componentSnapshot: json(snapshot),
          photoIds: photos.map((photo) => photo.id),
          submittedById: actor.id,
          submittedAt: new Date(),
        },
      });
      await tx.fleetPreparation.update({
        where: { id },
        data: { status: 'AWAITING_QC' },
      });
      await this.event(tx, p, actor, 'SUBMITTED', {
        revision: p.currentRevision,
      });
      return { id, revision: p.currentRevision };
    });
  }
  async review(
    clientId: string,
    actor: AuthUser,
    id: string,
    input: unknown,
    approve: boolean,
  ) {
    const b = parse(
      z
        .object({
          revision: z.number().int().min(1),
          reason: reasonSchema.optional(),
          failedItems: z.array(z.string()).max(80).default([]),
        })
        .strict(),
      input,
    );
    if (!approve && (!b.reason || !b.failedItems.length))
      throw new BadRequestException(
        'Rejection requires a reason and failed checklist items.',
      );
    return this.db.$transaction(async (tx) => {
      const p = await this.locked(tx, clientId, id);
      await this.access(tx, clientId, actor, p.hubId, 'canReview');
      const revision = await tx.fleetPreparationRevision.findUniqueOrThrow({
        where: {
          preparationId_revision: { preparationId: id, revision: b.revision },
        },
      });
      if (
        revision.decision === (approve ? 'APPROVED' : 'REJECTED') &&
        revision.reviewedById === actor.id &&
        (!approve
          ? revision.rejectionReason === b.reason &&
            JSON.stringify(revision.failedItems) ===
              JSON.stringify(b.failedItems)
          : true)
      )
        return { id, revision: b.revision };
      if (
        p.status !== 'AWAITING_QC' ||
        p.currentRevision !== b.revision ||
        revision.reviewedAt
      )
        throw new ConflictException(
          'This preparation revision is no longer awaiting review.',
        );
      const policy = parse(
        policySchema,
        (p.policySnapshot as { configuration: unknown }).configuration,
      );
      const contributed =
        policy.independentReview &&
        (revision.submittedById === actor.id ||
          p.createdById === actor.id ||
          p.assignedToId === actor.id ||
          (await tx.photo.count({
            where: {
              clientId,
              entityType: 'PREPARATION',
              entityId: revision.id,
              uploadedById: actor.id,
            },
          })) > 0 ||
          (await tx.fleetPreparationEvent.count({
            where: {
              clientId,
              preparationId: id,
              actorId: actor.id,
              action: {
                in: [
                  'DRAFT_SAVED',
                  'PHOTO_COMPLETED',
                  'REWORK_STARTED',
                  'INSTALLATION_SAVE',
                  'INSTALLATION_COMPONENTS',
                  'INSTALLATION_PHOTO',
                  'INSTALLATION_UPLOAD',
                  'INSTALLATION_SUBMIT',
                ],
              },
            },
          })) > 0);
      if (contributed)
        throw new ForbiddenException(
          'The preparer cannot approve or reject their own work.',
        );
      if (
        b.failedItems.some(
          (code) => !policy.items.some((item) => item.code === code),
        )
      )
        throw new BadRequestException('Unknown failed checklist item.');
      const fleet = await this.fleet(tx, clientId, p.fleetId);
      if (!isDeepStrictEqual(this.snapshot(fleet), revision.componentSnapshot))
        throw new ConflictException(
          'Hub or components changed. Start a fresh preparation.',
        );
      if (approve) {
        await this.requireStages(tx, p.id);
        if (
          !['IN_TRANSIT', 'INSPECTION_PENDING', 'AVAILABLE'].includes(
            fleet.status,
          )
        )
          throw new ConflictException(
            'Resolve maintenance or operational blocks before approval.',
          );
        if (
          await tx.allocation.count({
            where: {
              clientId,
              fleetId: p.fleetId,
              status: { notIn: ['COMPLETED', 'CANCELLED'] },
            },
          })
        )
          throw new ConflictException('Scooter has an unfinished allocation.');
        const openSubmission = await tx.vehicleSubmission.count({
          where: {
            clientId,
            fleetId: p.fleetId,
            OR: [
              { status: { notIn: ['CONFIRMED', 'CANCELLED'] } },
              { status: 'CONFIRMED', mechanicChecksComplete: false },
            ],
          },
        });
        if (openSubmission)
          throw new ConflictException(
            'Finish submission and mechanic checks before QC approval.',
          );
        if (
          (await tx.photo.count({
            where: {
              clientId,
              entityType: 'PREPARATION',
              entityId: revision.id,
              id: { in: revision.photoIds },
              status: 'COMPLETE',
            },
          })) !== revision.photoIds.length
        )
          throw new ConflictException('Submitted evidence changed.');
      }
      await tx.fleetPreparationRevision.update({
        where: { id: revision.id },
        data: {
          reviewedById: actor.id,
          reviewedAt: new Date(),
          decision: approve ? 'APPROVED' : 'REJECTED',
          rejectionReason: approve ? null : b.reason,
          failedItems: b.failedItems,
        },
      });
      await tx.fleetPreparation.update({
        where: { id },
        data: { status: approve ? 'APPROVED' : 'REWORK_REQUIRED' },
      });
      if (approve)
        await tx.fleet.update({
          where: { id: p.fleetId },
          data: {
            readinessApprovedPreparationId: id,
            allocationEnabled: !fleet.allocationBlockedByAdmin,
            status: 'AVAILABLE',
            onboardingStatus: 'ACTIVE',
            activatedAt: new Date(),
            odometerKm: (revision.checklist as { odometerKm: number })
              .odometerKm,
          },
        });
      await this.event(tx, p, actor, approve ? 'QC_APPROVED' : 'QC_REJECTED', {
        revision: b.revision,
        reason: b.reason,
        failedItems: b.failedItems,
      });
      return { id, revision: b.revision };
    });
  }
  async maintenance(
    clientId: string,
    actor: AuthUser,
    id: string,
    input: unknown,
  ) {
    const b = parse(
      z
        .object({ revision: z.number().int().min(1), reason: reasonSchema })
        .strict(),
      input,
    );
    return this.db.$transaction(async (tx) => {
      const { p } = await this.editable(tx, clientId, actor, id, b.revision);
      await tx.fleetPreparation.update({
        where: { id },
        data: { status: 'CANCELLED', invalidationReason: b.reason },
      });
      await tx.fleet.update({
        where: { id: p.fleetId },
        data: { status: 'MAINTENANCE', readinessApprovedPreparationId: null },
      });
      await tx.fleetStatusHistory.create({
        data: {
          fleetId: p.fleetId,
          toStatus: 'MAINTENANCE',
          changedByUserId: actor.id,
          reason: b.reason.slice(0, 255),
        },
      });
      await this.event(tx, p, actor, 'SENT_TO_MAINTENANCE', {
        reason: b.reason,
      });
      return { id };
    });
  }
  async cancel(clientId: string, actor: AuthUser, id: string, input: unknown) {
    if (!this.all(actor))
      throw new ForbiddenException(
        'Operations management permission is required.',
      );
    const b = parse(
      z
        .object({ revision: z.number().int().min(1), reason: reasonSchema })
        .strict(),
      input,
    );
    return this.db.$transaction(async (tx) => {
      const p = await this.locked(tx, clientId, id);
      if (p.currentRevision !== b.revision || closed.includes(p.status))
        throw new ConflictException(
          'Preparation cannot be cancelled in this state.',
        );
      await tx.fleetPreparation.update({
        where: { id },
        data: { status: 'CANCELLED', invalidationReason: b.reason },
      });
      await tx.fleet.update({
        where: { id: p.fleetId },
        data: { readinessApprovedPreparationId: null },
      });
      await this.event(tx, p, actor, 'CANCELLED', { reason: b.reason });
      return { id };
    });
  }
  async requireStages(tx: Tx, preparationId: string) {
    if (
      await tx.fleetInstallationStage.count({
        where: { preparationId, status: { not: 'COMPLETED' } },
      })
    )
      throw new ConflictException(
        'Complete all required installation stages before RFD submission or QC approval.',
      );
  }
  async readiness(clientId: string, actor: AuthUser, fleetId: string) {
    const fleet = await this.fleet(this.db, clientId, fleetId);
    if (!fleet.currentHubId)
      throw new BadRequestException('Scooter has no current hub.');
    await this.access(this.db, clientId, actor, fleet.currentHubId);
    const policy = await this.policy(clientId);
    const preparation = await this.db.fleetPreparation.findFirst({
      where: { clientId, fleetId },
      orderBy: { createdAt: 'desc' },
    });
    const blockers: string[] = [];
    if (fleet.status !== 'AVAILABLE')
      blockers.push(`Scooter status is ${fleet.status}.`);
    if (!fleet.allocationEnabled)
      blockers.push('Allocation is administratively disabled.');
    if (fleet.onboardingStatus !== 'ACTIVE')
      blockers.push('Fleet activation is incomplete.');
    if (
      ['PREPARATION_QC', 'STAGED_PREPARATION_QC'].includes(
        policy.operatingMode,
      ) &&
      !fleet.readinessApprovedPreparationId
    )
      blockers.push('Preparation and QC approval are required.');
    if (
      await this.db.allocation.count({
        where: {
          clientId,
          fleetId,
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        },
      })
    )
      blockers.push('Scooter has an unfinished allocation.');
    return {
      fleetId,
      operatingMode: policy.operatingMode,
      preparation,
      blockers,
      canAllocate: blockers.length === 0,
    };
  }
}
