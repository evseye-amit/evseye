import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type FleetInstallationStage } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../media/storage/storage-provider.interface.js';
import { FleetReadinessService } from './readiness.service.js';
import {
  parse,
  reasonSchema,
  resultSchema,
  stageDefinitionSchema,
  PHOTO_TYPE_VALUES,
} from './readiness-policy.js';
const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const bodySchema = z
  .object({
    revision: z.number().int().min(1),
    checklist: resultSchema.optional(),
    userId: z.string().uuid().optional(),
    reason: reasonSchema.optional(),
    failedItems: z.array(z.string()).max(40).optional(),
    batteryIds: z.array(z.string().uuid()).min(1).max(2).optional(),
    controllerId: z.string().uuid().optional(),
    iotDeviceId: z.string().uuid().optional(),
  })
  .strict();
@Injectable()
export class FleetInstallationService {
  constructor(
    private readonly db: PrismaService,
    private readonly readiness: FleetReadinessService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}
  private entity(s: FleetInstallationStage) {
    return `installation:${s.id}:${s.revision}`;
  }
  private async scope(
    tx: Prisma.TransactionClient,
    clientId: string,
    actor: AuthUser,
    id: string,
    lock = false,
  ) {
    const row = await tx.fleetInstallationStage.findFirst({
      where: { clientId, id },
    });
    if (!row) throw new NotFoundException('Installation stage not found.');
    const p0 = await tx.fleetPreparation.findFirstOrThrow({
      where: { id: row.preparationId, clientId },
    });
    if (lock) {
      await tx.$queryRaw`SELECT id FROM "Fleet" WHERE id=${p0.fleetId} AND "clientId"=${clientId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "FleetPreparation" WHERE id=${p0.id} FOR UPDATE`;
    }
    const p = await tx.fleetPreparation.findUniqueOrThrow({
      where: { id: p0.id },
    });
    const stage = await tx.fleetInstallationStage.findUniqueOrThrow({
      where: { id },
    });
    const fleet = await this.readiness.fleet(tx, clientId, p.fleetId);
    await this.readiness.access(tx, clientId, actor, p.hubId);
    if (fleet.currentHubId !== p.hubId)
      throw new ConflictException(
        'Scooter moved hubs. Start a new preparation cycle.',
      );
    const grant = await tx.fleetReadinessStaff.findUnique({
      where: {
        clientId_userId_hubId: { clientId, userId: actor.id, hubId: p.hubId },
      },
    });
    return {
      stage,
      p,
      fleet,
      grant,
      definition: parse(stageDefinitionSchema, stage.definition),
    };
  }
  async list(clientId: string, actor: AuthUser, input: unknown) {
    const q = parse(
      z
        .object({
          page: z.coerce.number().int().min(1).max(100000).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(20),
          hubId: z.string().uuid().optional(),
          stage: z.string().max(40).optional(),
          status: z
            .enum([
              'WAITING',
              'READY',
              'IN_PROGRESS',
              'SUBMITTED',
              'COMPLETED',
              'REWORK_REQUIRED',
            ])
            .optional(),
          assignedToId: z.string().uuid().optional(),
          search: z.string().trim().max(100).optional(),
        })
        .strict(),
      input,
    );
    const hubs = await this.readiness.hubs(this.db, clientId, actor);
    const where: Prisma.FleetInstallationStageWhereInput = {
      clientId,
      ...(q.stage ? { code: q.stage } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.assignedToId ? { assignedToId: q.assignedToId } : {}),
      preparation: {
        status: { notIn: ['CANCELLED', 'INVALIDATED'] },
        hubId: q.hubId
          ? {
              in:
                hubs.includes(q.hubId) || this.readiness.all(actor)
                  ? [q.hubId]
                  : [],
            }
          : this.readiness.all(actor)
            ? undefined
            : { in: hubs },
        ...(q.search
          ? {
              fleet: {
                OR: ['fleetCode', 'vehicleNumber', 'chassisNumber'].map(
                  (k) => ({ [k]: { contains: q.search, mode: 'insensitive' } }),
                ),
              },
            }
          : {}),
      },
    };
    const [items, total, summary] = await Promise.all([
      this.db.fleetInstallationStage.findMany({
        where,
        include: {
          preparation: {
            include: {
              fleet: {
                select: { id: true, fleetCode: true, vehicleNumber: true },
              },
              hub: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.db.fleetInstallationStage.count({ where }),
      this.db.fleetInstallationStage.groupBy({
        by: ['status'],
        where: { ...where, status: undefined },
        _count: true,
      }),
    ]);
    return { items, total, page: q.page, limit: q.limit, summary };
  }
  async inventory(
    clientId: string,
    actor: AuthUser,
    id: string,
    input: unknown,
  ) {
    const c = await this.scope(this.db, clientId, actor, id);
    const q = parse(
      z
        .object({
          page: z.coerce.number().int().min(1).max(100000).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(20),
          search: z.string().trim().max(100).default(''),
        })
        .strict(),
      input,
    );
    const paging = { skip: (q.page - 1) * q.limit, take: q.limit };
    if (c.definition.component === 'BATTERY') {
      const where: Prisma.BatteryWhereInput = {
        clientId,
        deletedAt: null,
        status: { in: ['AVAILABLE', 'INSTALLED'] },
        fleetHistory: {
          none: { removedAt: null, fleetId: { not: c.p.fleetId } },
        },
        serialNumber: { contains: q.search, mode: 'insensitive' },
      };
      const [items, total] = await Promise.all([
        this.db.battery.findMany({
          where,
          select: { id: true, serialNumber: true },
          orderBy: [{ serialNumber: 'asc' }, { id: 'asc' }],
          ...paging,
        }),
        this.db.battery.count({ where }),
      ]);
      return {
        items: items.map((r) => ({ id: r.id, label: r.serialNumber })),
        total,
        page: q.page,
        limit: q.limit,
      };
    }
    if (c.definition.component === 'CONTROLLER') {
      const where: Prisma.ControllerWhereInput = {
        clientId,
        deletedAt: null,
        status: { in: ['AVAILABLE', 'INSTALLED'] },
        fleetHistory: {
          none: { removedAt: null, fleetId: { not: c.p.fleetId } },
        },
        controllerNumber: { contains: q.search, mode: 'insensitive' },
      };
      const [items, total] = await Promise.all([
        this.db.controller.findMany({
          where,
          select: { id: true, controllerNumber: true },
          orderBy: [{ controllerNumber: 'asc' }, { id: 'asc' }],
          ...paging,
        }),
        this.db.controller.count({ where }),
      ]);
      return {
        items: items.map((r) => ({ id: r.id, label: r.controllerNumber })),
        total,
        page: q.page,
        limit: q.limit,
      };
    }
    if (c.definition.component === 'IOT') {
      const where: Prisma.IoTDeviceWhereInput = {
        clientId,
        status: { not: 'DAMAGED' },
        OR: [{ currentFleet: null }, { currentFleet: { id: c.p.fleetId } }],
        deviceNumber: { contains: q.search, mode: 'insensitive' },
      };
      const [items, total] = await Promise.all([
        this.db.ioTDevice.findMany({
          where,
          select: { id: true, deviceNumber: true },
          orderBy: [{ deviceNumber: 'asc' }, { id: 'asc' }],
          ...paging,
        }),
        this.db.ioTDevice.count({ where }),
      ]);
      return {
        items: items.map((r) => ({ id: r.id, label: r.deviceNumber })),
        total,
        page: q.page,
        limit: q.limit,
      };
    }
    return { items: [], total: 0, page: q.page, limit: q.limit };
  }
  async detail(clientId: string, actor: AuthUser, id: string) {
    const c = await this.scope(this.db, clientId, actor, id);
    const timeline = await this.db.fleetInstallationStage.findMany({
      where: { clientId, preparationId: c.p.id },
      orderBy: { code: 'asc' },
    });
    const photos = await this.db.photo.findMany({
      where: {
        clientId,
        workFlowType: 'FLEET_PREPARATION',
        subjectType: 'INSTALLATION',
        entityId: this.entity(c.stage),
        status: 'COMPLETE',
      },
    });
    const staff = await this.db.fleetReadinessStaff.findMany({
      where: {
        clientId,
        hubId: c.p.hubId,
        OR: [
          { stageCodes: { has: c.stage.code } },
          { reviewStageCodes: { has: c.stage.code } },
        ],
      },
      include: {
        user: {
          select: { id: true, name: true, isActive: true, deletedAt: true },
        },
      },
    });
    const [batteries, controllers, iotDevices] = await Promise.all([
      this.db.battery.findMany({
        where: {
          clientId,
          deletedAt: null,
          status: { in: ['AVAILABLE', 'INSTALLED'] },
          fleetHistory: {
            none: { removedAt: null, fleetId: { not: c.p.fleetId } },
          },
        },
        select: { id: true, serialNumber: true },
        take: 50,
        orderBy: { serialNumber: 'asc' },
      }),
      this.db.controller.findMany({
        where: {
          clientId,
          deletedAt: null,
          status: { in: ['AVAILABLE', 'INSTALLED'] },
          fleetHistory: {
            none: { removedAt: null, fleetId: { not: c.p.fleetId } },
          },
        },
        select: { id: true, controllerNumber: true },
        take: 50,
        orderBy: { controllerNumber: 'asc' },
      }),
      this.db.ioTDevice.findMany({
        where: {
          clientId,
          status: { not: 'DAMAGED' },
          OR: [{ currentFleet: null }, { currentFleet: { id: c.p.fleetId } }],
        },
        select: { id: true, deviceNumber: true },
        take: 50,
        orderBy: { deviceNumber: 'asc' },
      }),
    ]);
    const contributed =
      c.stage.submittedById === actor.id ||
      c.stage.assignedToId === actor.id ||
      (await this.db.fleetPreparationEvent.count({
        where: {
          clientId,
          preparationId: c.p.id,
          actorId: actor.id,
          action: {
            in: [
              'INSTALLATION_SAVE',
              'INSTALLATION_COMPONENTS',
              'INSTALLATION_PHOTO',
              'INSTALLATION_UPLOAD',
            ],
          },
          data: { path: ['stageId'], equals: id },
        },
      })) > 0;
    return {
      ...c.stage,
      requiredPhotoTypes: this.slots(c),
      inventory: { batteries, controllers, iotDevices },
      definition: c.definition,
      fleet: {
        id: c.fleet.id,
        fleetCode: c.fleet.fleetCode,
        vehicleNumber: c.fleet.vehicleNumber,
        chassisNumber: c.fleet.chassisNumber,
        modelName: c.fleet.modelName,
        currentHub: c.fleet.currentHub,
        status: c.fleet.status,
      },
      preparation: c.p,
      timeline,
      events: await this.db.fleetPreparationEvent.findMany({
        where: { clientId, preparationId: c.p.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      photos,
      components: this.readiness.snapshot(c.fleet),
      assignees: staff
        .filter(
          (g) =>
            g.user.isActive &&
            !g.user.deletedAt &&
            g.stageCodes.includes(c.stage.code),
        )
        .map((g) => g.user),
      permissions: {
        canWork: !!c.grant?.stageCodes.includes(c.stage.code),
        canReview:
          !!c.grant?.reviewStageCodes.includes(c.stage.code) && !contributed,
        canManage: this.readiness.all(actor),
        userId: actor.id,
      },
    };
  }
  private async prerequisites(
    tx: Prisma.TransactionClient,
    c: Awaited<ReturnType<FleetInstallationService['scope']>>,
    checkDependencies = true,
  ) {
    if (!['PENDING', 'IN_PROGRESS', 'REWORK_REQUIRED'].includes(c.p.status))
      throw new ConflictException('Preparation cycle is no longer editable.');
    if (!checkDependencies) return;
    const dependencies = await tx.fleetInstallationStage.findMany({
      where: { preparationId: c.p.id, code: { in: c.definition.dependencies } },
    });
    if (
      dependencies.length !== c.definition.dependencies.length ||
      dependencies.some((s) => s.status !== 'COMPLETED')
    )
      throw new ConflictException('Complete prerequisite stages first.');
  }
  private async work(
    tx: Prisma.TransactionClient,
    c: Awaited<ReturnType<FleetInstallationService['scope']>>,
    actor: AuthUser,
    revision: number,
  ) {
    await this.prerequisites(tx, c);
    if (
      !c.grant?.stageCodes.includes(c.stage.code) ||
      c.stage.assignedToId !== actor.id
    )
      throw new ForbiddenException(
        'Assigned installation staff permission is required.',
      );
    if (
      c.stage.revision !== revision ||
      !['IN_PROGRESS', 'REWORK_REQUIRED'].includes(c.stage.status)
    )
      throw new ConflictException(
        'Stage changed or is not editable. Reload it.',
      );
  }
  async action(
    clientId: string,
    actor: AuthUser,
    id: string,
    action: string,
    input: unknown,
  ) {
    const b = parse(bodySchema, input);
    return this.db.$transaction(
      async (tx) => {
        const c = await this.scope(tx, clientId, actor, id, true),
          s = c.stage;
        if (s.revision !== b.revision)
          throw new ConflictException('Revision changed. Reload it.');
        const data: Prisma.FleetInstallationStageUpdateInput = {};
        if (action === 'claim' || action === 'assign') {
          await this.prerequisites(tx, c, action === 'claim');
          if (
            !['WAITING', 'READY', 'IN_PROGRESS', 'REWORK_REQUIRED'].includes(
              s.status,
            )
          )
            throw new ConflictException('Stage cannot be assigned.');
          const userId = action === 'claim' ? actor.id : b.userId;
          if (!userId) throw new BadRequestException('Select staff.');
          if (action === 'assign' && !this.readiness.all(actor))
            throw new ForbiddenException('Management permission is required.');
          if (
            action === 'claim' &&
            s.assignedToId &&
            s.assignedToId !== actor.id
          )
            throw new ConflictException('Stage already assigned.');
          const grant = await tx.fleetReadinessStaff.findUnique({
            where: {
              clientId_userId_hubId: { clientId, userId, hubId: c.p.hubId },
            },
            include: { user: true },
          });
          if (
            !grant?.stageCodes.includes(s.code) ||
            !grant.user.isActive ||
            grant.user.deletedAt
          )
            throw new BadRequestException('Staff lacks this stage permission.');
          data.assignedToId = userId;
          data.status =
            s.status === 'REWORK_REQUIRED'
              ? 'REWORK_REQUIRED'
              : action === 'assign' && s.status === 'WAITING'
                ? 'WAITING'
                : 'IN_PROGRESS';
        } else if (action === 'save' || action === 'components') {
          await this.work(tx, c, actor, b.revision);
          if (s.status === 'REWORK_REQUIRED')
            throw new ConflictException('Start rework before editing.');
          if (action === 'components') await this.components(tx, c, b);
          else {
            if (!b.checklist)
              throw new BadRequestException('Checklist is required.');
            if (
              Object.keys(b.checklist).some(
                (code) => !c.definition.items.some((i) => i.code === code),
              )
            )
              throw new BadRequestException('Unknown checklist item.');
            data.checklist = json(b.checklist);
          }
        } else if (action === 'rework') {
          await this.work(tx, c, actor, b.revision);
          if (s.status !== 'REWORK_REQUIRED')
            throw new ConflictException('Stage does not require rework.');
          Object.assign(data, {
            revision: { increment: 1 },
            status: 'IN_PROGRESS',
            checklist: {},
            componentSnapshot: Prisma.DbNull,
            submittedById: null,
            submittedAt: null,
            reviewedById: null,
            reviewedAt: null,
            reason: null,
            failedItems: [],
          });
        } else if (action === 'submit') {
          if (
            ['SUBMITTED', 'COMPLETED'].includes(s.status) &&
            s.submittedById === actor.id
          )
            return { id, revision: s.revision };
          await this.work(tx, c, actor, b.revision);
          if (s.status !== 'IN_PROGRESS')
            throw new ConflictException('Start rework first.');
          const checks = parse(resultSchema, s.checklist);
          for (const item of c.definition.items) {
            const check = checks[item.code];
            if (
              (item.required && !check) ||
              check?.result === 'FAIL' ||
              (check?.result === 'NA' && (!item.allowNA || !check.notes.trim()))
            )
              throw new BadRequestException(
                'Complete stage checklist: ' + item.label,
              );
          }
          const snap = this.readiness.snapshot(c.fleet);
          if (
            (c.definition.component === 'BATTERY' && !snap.batteries.length) ||
            (c.definition.component === 'CONTROLLER' &&
              !snap.controllers.length) ||
            (c.definition.component === 'IOT' && !snap.iot)
          )
            throw new BadRequestException(
              'Required installed component is missing.',
            );
          const photos = await tx.photo.findMany({
            where: {
              clientId,
              workFlowType: 'FLEET_PREPARATION',
              subjectType: 'INSTALLATION',
              entityId: this.entity(s),
              status: 'COMPLETE',
            },
          });
          if (
            this.slots(c).some(
              (slot) => !photos.some((p) => p.photoType === slot),
            )
          )
            throw new BadRequestException('Upload all stage photos.');
          const history = Array.isArray(s.history) ? s.history : [];
          Object.assign(data, {
            componentSnapshot: json(this.componentSnapshot(c)),
            submittedById: actor.id,
            submittedAt: new Date(),
            status: c.definition.verificationRequired
              ? 'SUBMITTED'
              : 'COMPLETED',
            history: json([
              ...history,
              {
                revision: s.revision,
                checklist: s.checklist,
                componentSnapshot: this.componentSnapshot(c),
                photoIds: photos.map((p) => p.id),
                submittedById: actor.id,
                submittedAt: new Date().toISOString(),
              },
            ]),
          });
        } else if (action === 'approve' || action === 'reject') {
          if (!c.grant?.reviewStageCodes.includes(s.code))
            throw new ForbiddenException(
              'Stage reviewer permission is required.',
            );
          if (s.status !== 'SUBMITTED') {
            if (
              s.reviewedById === actor.id &&
              ((action === 'approve' && s.status === 'COMPLETED') ||
                (action === 'reject' &&
                  s.status === 'REWORK_REQUIRED' &&
                  s.reason === b.reason))
            )
              return { id, revision: s.revision };
            throw new ConflictException('Stage is not awaiting review.');
          }
          if (
            s.submittedById === actor.id ||
            s.assignedToId === actor.id ||
            (await tx.fleetPreparationEvent.count({
              where: {
                preparationId: c.p.id,
                actorId: actor.id,
                action: {
                  in: [
                    'INSTALLATION_SAVE',
                    'INSTALLATION_COMPONENTS',
                    'INSTALLATION_PHOTO',
                    'INSTALLATION_UPLOAD',
                  ],
                },
                data: { path: ['stageId'], equals: id },
              },
            }))
          )
            throw new ForbiddenException(
              'A contributor cannot review their own installation stage.',
            );
          await this.prerequisites(tx, c);
          if (
            !isDeepStrictEqual(s.componentSnapshot, this.componentSnapshot(c))
          )
            throw new ConflictException(
              'Component changed. Stage must be repeated.',
            );
          if (
            action === 'reject' &&
            (!b.reason ||
              !b.failedItems?.length ||
              b.failedItems.some(
                (code) => !c.definition.items.some((i) => i.code === code),
              ))
          )
            throw new BadRequestException(
              'Rejection requires a reason and valid failed items.',
            );
          Object.assign(data, {
            status: action === 'approve' ? 'COMPLETED' : 'REWORK_REQUIRED',
            reviewedById: actor.id,
            reviewedAt: new Date(),
            reason: b.reason ?? null,
            failedItems: b.failedItems ?? [],
            history: json([
              ...(Array.isArray(s.history) ? s.history : []),
              {
                revision: s.revision,
                decision: action,
                reviewedById: actor.id,
                reason: b.reason,
                failedItems: b.failedItems,
                at: new Date().toISOString(),
              },
            ]),
          });
        } else throw new BadRequestException('Unknown installation action.');
        const updated = await tx.fleetInstallationStage.update({
          where: { id },
          data,
        });
        await this.readiness.event(
          tx,
          c.p,
          actor,
          'INSTALLATION_' + action.toUpperCase(),
          {
            stageId: id,
            code: s.code,
            revision: s.revision,
            reason: b.reason,
            userId: b.userId,
          },
        );
        if (updated.status === 'COMPLETED') {
          const rows = await tx.fleetInstallationStage.findMany({
            where: { preparationId: c.p.id },
          });
          for (const row of rows.filter((r) => r.status === 'WAITING')) {
            const def = parse(stageDefinitionSchema, row.definition);
            if (
              def.dependencies.every((code) =>
                rows.some((r) => r.code === code && r.status === 'COMPLETED'),
              )
            )
              await tx.fleetInstallationStage.update({
                where: { id: row.id },
                data: { status: 'READY' },
              });
          }
        }
        return { id, revision: updated.revision };
      },
      { timeout: 15000 },
    );
  }
  private slots(c: Awaited<ReturnType<FleetInstallationService['scope']>>) {
    const snapshot = this.readiness.snapshot(c.fleet);
    const ids =
      c.definition.component === 'BATTERY'
        ? snapshot.batteries.map((b) => b.id)
        : c.definition.component === 'CONTROLLER'
          ? snapshot.controllers.map((b) => b.id)
          : c.definition.component === 'IOT'
            ? snapshot.iot
              ? [snapshot.iot.id]
              : []
            : [];
    return c.definition.component === 'NONE'
      ? c.definition.photoTypes
      : ids.flatMap((id) =>
          c.definition.photoTypes.map((slot) => `${id}_${slot}`),
        );
  }
  private componentSnapshot(
    c: Awaited<ReturnType<FleetInstallationService['scope']>>,
  ) {
    const s = this.readiness.snapshot(c.fleet);
    return c.definition.component === 'BATTERY'
      ? { batteries: s.batteries }
      : c.definition.component === 'CONTROLLER'
        ? { controllers: s.controllers }
        : c.definition.component === 'IOT'
          ? { iot: s.iot }
          : { hubId: s.hubId };
  }
  private async components(
    tx: Prisma.TransactionClient,
    c: Awaited<ReturnType<FleetInstallationService['scope']>>,
    b: z.infer<typeof bodySchema>,
  ) {
    // Lock component inventory before checking associations; never steal another scooter's hardware.
    if (c.definition.component === 'BATTERY' && b.batteryIds) {
      if (new Set(b.batteryIds).size !== b.batteryIds.length)
        throw new BadRequestException('Duplicate batteries.');
      for (const id of [...b.batteryIds].sort()) {
        await tx.$queryRaw`SELECT id FROM "Battery" WHERE id=${id} AND "clientId"=${c.p.clientId} FOR UPDATE`;
        const row = await tx.battery.findFirst({
          where: {
            id,
            clientId: c.p.clientId,
            deletedAt: null,
            status: { in: ['AVAILABLE', 'INSTALLED'] },
          },
        });
        if (
          !row ||
          (await tx.fleetBatteryHistory.count({
            where: {
              batteryId: id,
              removedAt: null,
              fleetId: { not: c.p.fleetId },
            },
          }))
        )
          throw new ConflictException(
            'Battery unavailable or installed on another scooter.',
          );
      }
      const old = c.fleet.batteryHistory.filter(
        (h) => !b.batteryIds!.includes(h.batteryId),
      );
      await tx.fleetBatteryHistory.updateMany({
        where: { id: { in: old.map((h) => h.id) } },
        data: {
          removedAt: new Date(),
          reason: 'Installation stage component replacement.',
        },
      });
      await tx.battery.updateMany({
        where: { id: { in: old.map((h) => h.batteryId) } },
        data: { status: 'AVAILABLE' },
      });
      const usedSlots = new Set(
        c.fleet.batteryHistory
          .filter((h) => b.batteryIds!.includes(h.batteryId))
          .map((h) => h.batterySlot),
      );
      for (const id of b.batteryIds)
        if (!c.fleet.batteryHistory.some((h) => h.batteryId === id)) {
          await tx.battery.update({
            where: { id },
            data: { status: 'INSTALLED' },
          });
          const slot = usedSlots.has('PRIMARY') ? 'SECONDARY' : 'PRIMARY';
          usedSlots.add(slot);
          await tx.fleetBatteryHistory.create({
            data: {
              fleetId: c.p.fleetId,
              batteryId: id,
              batterySlot: slot,
              installedAt: new Date(),
            },
          });
        }
    } else if (c.definition.component === 'CONTROLLER' && b.controllerId) {
      const id = b.controllerId;
      await tx.$queryRaw`SELECT id FROM "Controller" WHERE id=${id} AND "clientId"=${c.p.clientId} FOR UPDATE`;
      if (
        !(await tx.controller.findFirst({
          where: {
            id,
            clientId: c.p.clientId,
            deletedAt: null,
            status: { in: ['AVAILABLE', 'INSTALLED'] },
          },
        })) ||
        (await tx.fleetControllerHistory.count({
          where: {
            controllerId: id,
            removedAt: null,
            fleetId: { not: c.p.fleetId },
          },
        }))
      )
        throw new ConflictException(
          'Controller unavailable or installed on another scooter.',
        );
      if (!c.fleet.controllerHistory.some((h) => h.controllerId === id)) {
        await tx.fleetControllerHistory.updateMany({
          where: { fleetId: c.p.fleetId, removedAt: null },
          data: {
            removedAt: new Date(),
            reason: 'Installation stage replacement.',
          },
        });
        await tx.controller.updateMany({
          where: {
            id: { in: c.fleet.controllerHistory.map((h) => h.controllerId) },
          },
          data: { status: 'AVAILABLE' },
        });
        await tx.controller.update({
          where: { id },
          data: { status: 'INSTALLED' },
        });
        await tx.fleetControllerHistory.create({
          data: {
            fleetId: c.p.fleetId,
            controllerId: id,
            installedAt: new Date(),
          },
        });
      }
    } else if (c.definition.component === 'IOT' && b.iotDeviceId) {
      const id = b.iotDeviceId;
      await tx.$queryRaw`SELECT id FROM "IoTDevice" WHERE id=${id} AND "clientId"=${c.p.clientId} FOR UPDATE`;
      if (
        !(await tx.ioTDevice.findFirst({
          where: { id, clientId: c.p.clientId, status: { not: 'DAMAGED' } },
        })) ||
        (await tx.fleet.count({
          where: { iotDeviceId: id, id: { not: c.p.fleetId } },
        }))
      )
        throw new ConflictException(
          'IoT device unavailable or assigned to another scooter.',
        );
      await tx.fleet.update({
        where: { id: c.p.fleetId },
        data: { iotDeviceId: id },
      });
      if (c.fleet.iotDeviceId !== id) {
        if (c.fleet.iotDeviceId)
          await tx.ioTDevice.update({
            where: { id: c.fleet.iotDeviceId },
            data: { status: 'UNASSIGNED' },
          });
        await tx.ioTDevice.update({
          where: { id },
          data: {
            status: 'ACTIVE',
            installedAt: new Date(),
            activatedAt: new Date(),
          },
        });
      }
    } else
      throw new BadRequestException(
        'Supply components matching this installation stage.',
      );
  }
  async upload(clientId: string, actor: AuthUser, id: string, input: unknown) {
    const b = parse(
      z
        .object({
          revision: z.number().int().min(1),
          photoType: z.enum(PHOTO_TYPE_VALUES),
          mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
          sizeBytes: z
            .number()
            .int()
            .min(1)
            .max(5 * 1024 * 1024),
        })
        .strict(),
      input,
    );
    const photo = await this.db.$transaction(async (tx) => {
      const c = await this.scope(tx, clientId, actor, id, true);
      await this.work(tx, c, actor, b.revision);
      if (
        c.stage.status !== 'IN_PROGRESS' ||
        !this.slots(c).includes(b.photoType)
      )
        throw new BadRequestException(
          'Stage is not editable or photo slot is invalid.',
        );
      await this.readiness.event(tx, c.p, actor, 'INSTALLATION_UPLOAD', {
        stageId: id,
        revision: c.stage.revision,
      });
      return tx.photo.create({
        data: {
          clientId,
          workFlowType: 'FLEET_PREPARATION',
          subjectType: 'INSTALLATION',
          entityId: this.entity(c.stage),
          photoType: b.photoType,
          mimeType: b.mimeType,
          sizeBytes: b.sizeBytes,
          uploadedById: actor.id,
          objectKey: `clients/${clientId}/installation/${id}/${randomUUID()}`,
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
  async complete(
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
    const c = await this.scope(this.db, clientId, actor, id);
    await this.work(this.db, c, actor, b.revision);
    const photo = await this.db.photo.findFirst({
      where: {
        id: photoId,
        clientId,
        workFlowType: 'FLEET_PREPARATION',
        subjectType: 'INSTALLATION',
        entityId: this.entity(c.stage),
      },
    });
    if (!photo) throw new NotFoundException('Stage photo not found.');
    if (photo.status === 'COMPLETE') return photo;
    if (photo.status !== 'PENDING_UPLOAD')
      throw new ConflictException('Photo cannot be completed.');
    const key = `clients/${clientId}/installation/${id}/sealed/${randomUUID()}`;
    await this.storage.sealObject(photo.objectKey, key);
    await this.storage.assertObjectExists(key, { maxBytes: photo.sizeBytes });
    return this.db.$transaction(async (tx) => {
      const c = await this.scope(tx, clientId, actor, id, true);
      await this.work(tx, c, actor, b.revision);
      if (c.stage.status !== 'IN_PROGRESS')
        throw new ConflictException('Start rework first.');
      const fresh = await tx.photo.findUniqueOrThrow({
        where: { id: photoId },
      });
      if (fresh.status === 'COMPLETE') return fresh;
      await tx.photo.updateMany({
        where: {
          clientId,
          workFlowType: 'FLEET_PREPARATION',
          subjectType: 'INSTALLATION',
          entityId: this.entity(c.stage),
          photoType: photo.photoType,
          status: 'COMPLETE',
        },
        data: { status: 'DELETED' },
      });
      const result = await tx.photo.update({
        where: { id: photoId },
        data: { objectKey: key, status: 'COMPLETE', uploadedAt: new Date() },
      });
      await this.readiness.event(tx, c.p, actor, 'INSTALLATION_PHOTO', {
        stageId: id,
        photoId,
        revision: b.revision,
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
    const entities = [
      this.entity(detail),
      ...Array.from(
        { length: detail.revision - 1 },
        (_, i) => `installation:${id}:${i + 1}`,
      ),
    ];
    const photo = await this.db.photo.findFirst({
      where: {
        clientId,
        id: photoId,
        workFlowType: 'FLEET_PREPARATION',
        subjectType: 'INSTALLATION',
        entityId: { in: entities },
        status: 'COMPLETE',
      },
    });
    if (!photo) throw new NotFoundException('Stage photo not found.');
    return { url: await this.storage.createDownloadUrl(photo.objectKey) };
  }
}
