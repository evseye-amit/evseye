import { maintenanceCondition } from './maintenance-condition.js';
import {
  invoiceSubmissionPenalty,
  paymentView,
} from '../submission-penalties/penalty-accounting.js';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type VehicleSubmission } from '@prisma/client';
import { createHash } from 'node:crypto';
import { normalizeIndianMobile } from '../common/phone.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AllocationsService } from '../allocations/allocations.service.js';
import { AuthService } from '../auth/auth.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { RiderBillingService } from '../rider-billing/rider-billing.service.js';
import type {
  ConfirmSubmissionReportDto,
  MechanicReportDto,
} from './submission.dto.js';

type Tx = Prisma.TransactionClient;
type Source = 'RETURN' | 'EXCHANGE';
type ItemSnapshot = {
  configurationVersion?: number;
  isSpare?: boolean;
  spare?: {
    name: string;
    code: string;
    origin: string;
    masterSpareId: string | null;
    sourceVersion: number | null;
    baseRate: string | null;
    gstPercent: string | null;
    hsnCode: string | null;
    unit: string;
  };
  evidenceRequired?: boolean;
  findingId?: string;

  priceId: string;
  code: string;
  category: string;
  description: string;
  quantity: number;
  unitAmount: string;
  amount: string;
  currency: string;
  details: string;
  evidencePhotoIds: string[];
  findingKey: string;
};
const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : value && typeof value === 'object'
      ? `{${Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
          .join(',')}}`
      : JSON.stringify(value);
const hash = (value: unknown) =>
  createHash('sha256').update(canonical(value)).digest('hex');
const guidance =
  'Review the photos, mechanic report and penalties with the rider. Rider and team lead OTPs confirm the reviewed submission. If an OTP is unavailable, explain and record a bypass reason.';

@Injectable()
export class VehicleSubmissionService {
  constructor(
    private readonly db: PrismaService,
    private readonly allocations: AllocationsService,
    private readonly auth: AuthService,
    private readonly billing: RiderBillingService,
  ) {}

  private async transaction<T>(fn: (tx: Tx) => Promise<T>) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 20000,
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (['P2034', 'P2002'].includes(error.code) ||
            (error.code === 'P2010' &&
              ['40001', '40P01'].includes(String(error.meta?.code)))) &&
          attempt < 3
        )
          continue;
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          throw new ConflictException(
            'Submission changed concurrently. Refresh and try again.',
          );
        throw error;
      }
    }
  }
  private audit(
    tx: Tx,
    clientId: string,
    actorId: string,
    action: string,
    entityId: string,
    data: Record<string, unknown> = {},
  ) {
    return tx.auditLog.create({
      data: {
        clientId,
        actorId,
        action,
        entityType: 'VehicleSubmission',
        entityId,
        newData: data as Prisma.InputJsonValue,
      },
    });
  }
  private async staffHub(
    db: Tx,
    clientId: string,
    actor: AuthUser,
    hubId: string,
  ) {
    if (
      !actor.roles.some((role) =>
        ['CLIENT_ADMIN', 'OPERATIONS_MANAGER', 'FLEET_MANAGER'].includes(role),
      )
    )
      throw new ForbiddenException('Staff access is required.');
    if (
      actor.roles.includes('FLEET_MANAGER') &&
      !actor.roles.some((role) =>
        ['CLIENT_ADMIN', 'OPERATIONS_MANAGER'].includes(role),
      )
    ) {
      if (
        !(await db.userHub.findFirst({
          where: {
            clientId,
            userId: actor.id,
            hubId,
            hub: { clientId, status: 'ACTIVE', deletedAt: null },
          },
        }))
      )
        throw new NotFoundException('Submission is not in an assigned hub.');
    }
  }
  private async accessible(
    db: Tx,
    clientId: string,
    actor: AuthUser,
    id: string,
  ) {
    const row = await db.vehicleSubmission.findFirst({
      where: { id, clientId },
    });
    if (!row) throw new NotFoundException('Vehicle submission not found.');
    if (actor.roles.includes('RIDER')) {
      if (
        !(await db.rider.findFirst({
          where: {
            id: row.riderId,
            clientId,
            userId: actor.id,
            deletedAt: null,
          },
        }))
      )
        throw new NotFoundException('Vehicle submission not found.');
    } else await this.staffHub(db, clientId, actor, row.hubId);
    return row;
  }

  async queue(
    clientId: string,
    actor: AuthUser,
    source: Source,
    phase: 'SCHEDULED' | 'CHECKS' | 'ALL',
    page: number,
    limit: number,
  ) {
    if (
      !actor.roles.some((role) =>
        ['CLIENT_ADMIN', 'OPERATIONS_MANAGER', 'FLEET_MANAGER'].includes(role),
      )
    )
      throw new ForbiddenException('Staff access is required.');
    const restricted =
      actor.roles.includes('FLEET_MANAGER') &&
      !actor.roles.some((role) =>
        ['CLIENT_ADMIN', 'OPERATIONS_MANAGER'].includes(role),
      );
    const hubs = restricted
      ? await this.db.userHub.findMany({
          where: { clientId, userId: actor.id },
          select: { hubId: true },
        })
      : [];
    const scope = restricted
      ? {
          OR: [
            { plannedHubId: { in: hubs.map((hub) => hub.hubId) } },
            {
              vehicleSubmission: {
                is: { hubId: { in: hubs.map((hub) => hub.hubId) } },
              },
            },
          ],
        }
      : {};
    const progress =
      phase === 'SCHEDULED'
        ? { vehicleSubmission: { is: null } }
        : phase === 'CHECKS'
          ? {
              vehicleSubmission: {
                is: {
                  OR: [
                    { status: { not: 'CONFIRMED' } },
                    { mechanicChecksComplete: false },
                  ],
                },
              },
            }
          : {};
    const common = {
      clientId,
      submissionRequired: true,
      AND: [scope, progress],
    };
    const where = {
      ...common,
      status: { notIn: ['CANCELLED' as const, 'REJECTED' as const] },
    };
    const args = {
      where,
      orderBy: { createdAt: 'asc' as const },
      skip: (page - 1) * limit,
      take: limit,
      include: { vehicleSubmission: true },
    };
    const [rows, total] =
      source === 'RETURN'
        ? await Promise.all([
            this.db.rentalTerminationRequest.findMany({
              ...args,
              include: {
                ...args.include,
                allocation: { select: { fleetId: true } },
              },
            }),
            this.db.rentalTerminationRequest.count({ where }),
          ])
        : await Promise.all([
            this.db.vehicleExchangeRequest.findMany(args),
            this.db.vehicleExchangeRequest.count({ where }),
          ]);
    const riders = await this.db.rider.findMany({
      where: { clientId, id: { in: rows.map((row) => row.riderId) } },
      select: { id: true, name: true, mobile: true },
    });
    const fleetIdFor = (row: (typeof rows)[number]) =>
      row.vehicleSubmission?.fleetId ??
      ('oldVehicleId' in row ? row.oldVehicleId : row.allocation?.fleetId);
    const fleetIds = [
      ...new Set(rows.map(fleetIdFor).filter((id): id is string => !!id)),
    ];
    const fleets = fleetIds.length
      ? await this.db.fleet.findMany({
          where: { clientId, id: { in: fleetIds } },
          select: {
            id: true,
            fleetCode: true,
            vehicleNumber: true,
            chassisNumber: true,
            modelName: true,
            variantName: true,
            colour: true,
            status: true,
            oem: { select: { id: true, name: true } },
            vehicleType: { select: { id: true, name: true } },
            currentHub: { select: { id: true, code: true, name: true } },
          },
        })
      : [];
    const fleetsById = new Map(fleets.map((fleet) => [fleet.id, fleet]));
    return {
      data: rows.map((row) => {
        // The allocation is only loaded to resolve the returned scooter.
        const { allocation: _allocation, ...request } =
          'allocation' in row ? row : { ...row, allocation: undefined };
        return {
          ...request,
          source,
          rider: riders.find((rider) => rider.id === row.riderId) ?? null,
          fleet: fleetsById.get(fleetIdFor(row) ?? '') ?? null,
        };
      }),
      meta: { page, limit, total },
    };
  }

  async start(
    clientId: string,
    actor: AuthUser,
    source: Source,
    requestId: string,
    selectedHubId?: string,
  ) {
    return this.transaction(async (tx) => {
      const request =
        source === 'RETURN'
          ? await tx.rentalTerminationRequest.findFirst({
              where: { clientId, id: requestId },
              include: { agreement: true },
            })
          : await tx.vehicleExchangeRequest.findFirst({
              where: { clientId, id: requestId },
              include: { agreement: true },
            });
      if (!request)
        throw new NotFoundException('Return or exchange request not found.');
      const existing = await tx.vehicleSubmission.findFirst({
        where: {
          clientId,
          ...(source === 'RETURN'
            ? { returnRequestId: requestId }
            : { exchangeRequestId: requestId }),
        },
      });
      if (existing) {
        await this.staffHub(tx, clientId, actor, existing.hubId);
        if (selectedHubId && selectedHubId !== existing.hubId)
          throw new ConflictException('Submission hub is already recorded.');
        return existing;
      }
      if (
        source === 'RETURN'
          ? request.status !== 'REQUESTED'
          : !['REQUESTED', 'APPROVED', 'RETURN_PENDING'].includes(
              request.status,
            )
      )
        throw new ConflictException(
          'Request is not ready for vehicle submission.',
        );
      const hubId = selectedHubId ?? request.plannedHubId;
      if (
        !hubId ||
        !(await tx.hub.findFirst({
          where: {
            id: hubId,
            clientId,
            status: 'ACTIVE',
            deletedAt: null,
            supportsDeallocation: true,
          },
        }))
      )
        throw new BadRequestException('An active receiving hub is required.');
      await this.staffHub(tx, clientId, actor, hubId);
      const allocationId =
        source === 'RETURN'
          ? (request as { allocationId: string | null }).allocationId
          : (request as { oldAllocationId: string | null }).oldAllocationId;
      if (!allocationId)
        throw new ConflictException('An active allocation is required.');
      const allocation = await tx.allocation.findFirst({
        where: {
          id: allocationId,
          clientId,
          riderId: request.riderId,
          status: { in: ['ACTIVE', 'DEALLOCATION_INITIATED'] },
        },
        include: {
          fleet: {
            include: {
              batteryHistory: {
                where: { removedAt: null },
                include: { battery: true },
              },
              controllerHistory: {
                where: { removedAt: null },
                include: { controller: true },
              },
            },
          },
        },
      });
      if (!allocation)
        throw new ConflictException(
          'The vehicle is not actively allocated to this rider.',
        );
      const competing =
        source === 'RETURN'
          ? await tx.vehicleExchangeRequest.findFirst({
              where: {
                clientId,
                oldAllocationId: allocationId,
                status: {
                  in: [
                    'REQUESTED',
                    'APPROVED',
                    'REPLACEMENT_SELECTED',
                    'OFFER_PRESENTED',
                    'ACCEPTED',
                    'RETURN_PENDING',
                    'DEPOSIT_PENDING',
                    'HANDOVER_PENDING',
                  ],
                },
              },
            })
          : await tx.rentalTerminationRequest.findFirst({
              where: { clientId, allocationId, status: 'REQUESTED' },
            });
      if (competing)
        throw new ConflictException(
          'A different return or exchange request is active for this vehicle.',
        );
      const inspection =
        await this.allocations.initiateDeallocationInTransaction(
          tx,
          clientId,
          allocationId,
        );
      const batteries = allocation.fleet.batteryHistory.map((entry) => ({
        id: entry.battery.id,
        code: entry.battery.batteryCode,
        serialNumber: entry.battery.serialNumber,
      }));
      const controllers = allocation.fleet.controllerHistory.map((entry) => ({
        id: entry.controller.id,
        number: entry.controller.controllerNumber,
      }));
      const configured = await tx.photoRequirement.findMany({
        where: { clientId, entityType: 'INSPECTION', isRequired: true },
        select: { photoType: true },
      });
      const requiredPhotoTypes = [
        ...new Set([
          'VEHICLE_FRONT',
          'VEHICLE_REAR',
          'VEHICLE_LEFT',
          'VEHICLE_RIGHT',
          'RETURN_CHECKLIST',
          ...(batteries.length
            ? batteries.map((battery) => `BATTERY_${battery.id}`)
            : ['BATTERY']),
          ...(controllers.length
            ? controllers.map((controller) => `CONTROLLER_${controller.id}`)
            : ['CONTROLLER']),
          ...(allocation.fleet.iotDeviceId
            ? [`IOT_${allocation.fleet.iotDeviceId}`]
            : []),
          ...configured.map((entry) => entry.photoType),
        ]),
      ];
      const row = await tx.vehicleSubmission.create({
        data: {
          clientId,
          allocationId,
          inspectionId: inspection.inspectionId,
          ...(source === 'RETURN'
            ? { returnRequestId: requestId }
            : { exchangeRequestId: requestId }),
          riderId: allocation.riderId,
          fleetId: allocation.fleetId,
          agreementId: request.agreementId,
          hubId,
          createdById: actor.id,
          requiredPhotoTypes,
          assetSnapshot: {
            fleetId: allocation.fleetId,
            vehicleNumber: allocation.fleet.vehicleNumber,
            chassisNumber: allocation.fleet.chassisNumber,
            batteries,
            controllers,
            iotDeviceId: allocation.fleet.iotDeviceId,
          },
        },
      });
      await tx.fleet.update({
        where: { id: allocation.fleetId },
        data: {
          currentHubId: hubId,
          allocationEnabled: false,
          status: 'DEALLOCATION_IN_PROGRESS',
        },
      });
      if (source === 'RETURN')
        await tx.rentalTerminationRequest.update({
          where: { id: requestId },
          data: { submissionRequired: true, plannedHubId: hubId },
        });
      if (source === 'EXCHANGE')
        await tx.vehicleExchangeRequest.update({
          where: { id: requestId },
          data: {
            submissionRequired: true,
            plannedHubId: hubId,
            status: 'RETURN_PENDING',
            returnInspectionId: inspection.inspectionId,
            updatedById: actor.id,
          },
        });
      await this.audit(
        tx,
        clientId,
        actor.id,
        'VEHICLE_SUBMISSION_STARTED',
        row.id,
        { source, requestId, inspectionId: row.inspectionId, hubId },
      );
      return row;
    });
  }

  async get(clientId: string, actor: AuthUser, id: string) {
    const row = await this.accessible(this.db, clientId, actor, id);
    const [reports, photos, rider, hub] = await Promise.all([
      this.db.vehicleSubmissionReport.findMany({
        where: { clientId, submissionId: id },
        orderBy: { createdAt: 'asc' },
      }),
      this.db.photo.findMany({
        where: {
          clientId,
          entityType: 'INSPECTION',
          entityId: row.inspectionId,
          status: 'COMPLETE',
        },
        orderBy: { uploadedAt: 'asc' },
      }),
      this.db.rider.findFirst({
        where: { clientId, id: row.riderId },
        select: { id: true, name: true, mobile: true },
      }),
      this.db.hub.findFirst({
        where: { clientId, id: row.hubId },
        select: { id: true, name: true, code: true },
      }),
    ]);
    return {
      ...row,
      rider,
      hub,
      reports,
      photos,
      confirmationGuidance: guidance,
      missingPhotoTypes: row.requiredPhotoTypes.filter(
        (type) => !photos.some((photo) => photo.photoType === type),
      ),
      nextAction:
        row.status === 'CONFIRMED'
          ? 'COMPLETE'
          : reports.some((report) => report.status === 'SUBMITTED')
            ? 'COLLECT_OTPS_OR_RECORD_BYPASS'
            : reports.some((report) => report.status === 'DRAFT')
              ? 'REVIEW_AND_IMPOSE'
              : 'CAPTURE_PHOTOS_AND_BASIC_REPORT',
    };
  }

  async authorizePhoto(
    clientId: string,
    actor: AuthUser,
    submissionId: string,
    photoId: string,
  ) {
    const submission = await this.accessible(
      this.db,
      clientId,
      actor,
      submissionId,
    );
    const photo = await this.db.photo.findFirst({
      where: {
        id: photoId,
        clientId,
        entityType: 'INSPECTION',
        entityId: submission.inspectionId,
        status: 'COMPLETE',
      },
      select: { id: true },
    });
    if (!photo) throw new NotFoundException('Submission proof not found.');
    return photo.id;
  }

  async recordReport(
    clientId: string,
    actor: AuthUser,
    id: string,
    input: MechanicReportDto,
    requestKey: string,
    edit?: { reportId: string; expectedDigest: string },
  ) {
    if (!/^[A-Za-z0-9:_-]{8,120}$/.test(requestKey ?? ''))
      throw new BadRequestException('A stable Idempotency-Key is required.');
    if (!input.mechanicName.trim() || !input.summary.trim())
      throw new BadRequestException('Mechanic name and report are required.');
    this.assertBasicReportWrite(input.stage);
    if (
      (!input.safeForReuse || input.fleetStatus !== 'AVAILABLE') &&
      !input.unsafeReason?.trim()
    )
      throw new BadRequestException('Explain what needs work on the vehicle.');
    const condition = maintenanceCondition(input);
    return this.transaction(async (tx) => {
      const submission = await this.accessible(tx, clientId, actor, id);
      await this.staffHub(tx, clientId, actor, submission.hubId);
      const old = await tx.vehicleSubmissionReport.findUnique({
        where: {
          clientId_submissionId_requestKey: {
            clientId,
            submissionId: id,
            requestKey,
          },
        },
      });
      if (edit && (!old || old.id !== edit.reportId || old.status !== 'DRAFT'))
        throw new ConflictException('Only a draft report can be edited.');
      if (old) {
        const snapshot = old.items as unknown as ItemSnapshot[];
        const same =
          old.fleetStatus === condition.fleetStatus &&
          old.stage === input.stage &&
          old.mechanicName === input.mechanicName.trim() &&
          old.summary === input.summary.trim() &&
          old.safeForReuse === input.safeForReuse &&
          old.unsafeReason ===
            (input.fleetStatus === 'AVAILABLE' && input.safeForReuse
              ? null
              : input.unsafeReason!.trim()) &&
          old.checksComplete === Boolean(input.checksComplete) &&
          JSON.stringify([...old.evidencePhotoIds].sort()) ===
            JSON.stringify([...new Set(input.evidencePhotoIds)].sort()) &&
          snapshot.length === input.items.length &&
          snapshot.every(
            (item, index) =>
              item.priceId === input.items[index]!.priceId &&
              ((!item.isSpare &&
                input.items[index]!.configurationVersion === undefined) ||
                item.configurationVersion ===
                  input.items[index]!.configurationVersion) &&
              item.category ===
                (input.items[index]!.findingType ??
                  (item.isSpare ? 'DAMAGE' : item.category)) &&
              (item.findingId ?? null) ===
                (input.items[index]!.findingId ?? null) &&
              item.quantity === (input.items[index]!.quantity ?? 1) &&
              item.details === input.items[index]!.details.trim() &&
              JSON.stringify(item.evidencePhotoIds) ===
                JSON.stringify(
                  [...new Set(input.items[index]!.evidencePhotoIds)].sort(),
                ),
          );
        if (same) return old;
        if (!edit)
          throw new ConflictException(
            'Idempotency-Key was used for a different report.',
          );
        if (old.digest !== edit.expectedDigest)
          throw new ConflictException(
            'Draft report changed. Reload before editing.',
          );
        if (old.stage !== input.stage)
          throw new BadRequestException('Report stage cannot be changed.');
      }
      if (submission.status !== 'IN_PROGRESS')
        throw new ConflictException(
          'Report stage does not match the submission.',
        );
      const reports = await tx.vehicleSubmissionReport.findMany({
        where: {
          clientId,
          submissionId: id,
          status: { not: 'CANCELLED' },
          ...(edit ? { id: { not: edit.reportId } } : {}),
        },
      });
      if (
        reports.some((report) => ['DRAFT', 'SUBMITTED'].includes(report.status))
      )
        throw new ConflictException(
          'Finish or cancel the pending report first.',
        );
      if (
        input.stage === 'BASIC' &&
        reports.some((report) => report.stage === 'BASIC')
      )
        throw new ConflictException('Basic report already exists.');
      const photos = await tx.photo.findMany({
        where: {
          clientId,
          entityType: 'INSPECTION',
          entityId: submission.inspectionId,
          status: 'COMPLETE',
        },
        select: { id: true, photoType: true },
      });
      const photoIds = new Set(photos.map((photo) => photo.id));
      if (input.stage === 'BASIC') {
        const missing = submission.requiredPhotoTypes.filter(
          (type) => !photos.some((photo) => photo.photoType === type),
        );
        if (missing.length)
          throw new BadRequestException({
            message:
              'Capture all vehicle and component photos before submission.',
            missing,
          });
      }
      if (
        !input.evidencePhotoIds.length ||
        input.evidencePhotoIds.some((photo) => !photoIds.has(photo))
      )
        throw new BadRequestException(
          'A mechanic report needs proof from this submission inspection.',
        );
      const vehicle = await tx.fleet.findFirstOrThrow({
        where: { id: submission.fleetId, clientId },
        select: { vehicleTypeId: true },
      });
      const prices = input.items.length
        ? await tx.returnPenaltyPrice.findMany({
            where: {
              clientId,
              id: { in: input.items.map((item) => item.priceId) },
            },
          })
        : [];
      const used = new Set(
        reports.flatMap((report) =>
          (report.items as unknown as ItemSnapshot[]).flatMap((item) => [
            item.findingKey,
            item.evidencePhotoIds.length
              ? hash([item.priceId, [...item.evidencePhotoIds].sort()])
              : hash([
                  item.priceId,
                  item.category,
                  item.details.trim().replace(/\s+/g, ' ').toLowerCase(),
                ]),
          ]),
        ),
      );
      const items: ItemSnapshot[] = input.items.map((item) => {
        const price = prices.find((candidate) => candidate.id === item.priceId);
        if (!price || !['DAMAGE', 'MISSING_ITEM'].includes(price.category))
          throw new BadRequestException(
            'Select an active penalty price for this client.',
          );
        if (
          (price.isSpare && item.configurationVersion === undefined) ||
          (item.configurationVersion !== undefined &&
            item.configurationVersion !== price.configurationVersion)
        )
          throw new ConflictException({
            code: 'PENALTY_CATALOGUE_CHANGED',
            message:
              'Penalty pricing or evidence settings changed. Refresh the penalty list and review the amount again.',
            priceId: price.id,
            currentVersion: price.configurationVersion,
          });
        if (
          price.vehicleTypeIds.length &&
          !price.vehicleTypeIds.includes(vehicle.vehicleTypeId)
        )
          throw new BadRequestException(
            'Penalty is not applicable to this vehicle type.',
          );
        const category = item.findingType ?? price.category;
        if (!price.isSpare && category !== price.category)
          throw new BadRequestException(
            'Finding type does not match this penalty.',
          );
        if (!price.isActive || !price.penaltyConfigured)
          throw new ConflictException({
            code: 'PENALTY_CATALOGUE_CHANGED',
            message:
              'This penalty is no longer enabled. Refresh the penalty list.',
          });
        const evidenceRequired = price.evidenceRequired !== false;
        const evidencePhotoIds = [...new Set(item.evidencePhotoIds)].sort();
        if (
          !item.details.trim() ||
          (evidenceRequired && !evidencePhotoIds.length) ||
          evidencePhotoIds.some((photo) => !photoIds.has(photo))
        )
          throw new BadRequestException(
            'Every penalty needs details and any required proof; supplied evidence must belong to this vehicle submission.',
          );
        if (
          evidenceRequired &&
          category === 'MISSING_ITEM' &&
          !evidencePhotoIds.some(
            (photo) =>
              photos.find((entry) => entry.id === photo)?.photoType ===
              'RETURN_CHECKLIST',
          )
        )
          throw new BadRequestException(
            'Missing items need a return checklist photo as proof.',
          );
        const findingKey = item.findingId
          ? hash(['FINDING', id, item.findingId])
          : evidencePhotoIds.length
            ? hash([price.id, evidencePhotoIds])
            : hash([
                price.id,
                category,
                item.details.trim().replace(/\s+/g, ' ').toLowerCase(),
              ]);
        const fingerprint = evidencePhotoIds.length
          ? hash([price.id, evidencePhotoIds])
          : hash([
              price.id,
              category,
              item.details.trim().replace(/\s+/g, ' ').toLowerCase(),
            ]);
        if (used.has(findingKey) || used.has(fingerprint))
          throw new ConflictException(
            'This finding already appears in a report. It cannot be charged twice.',
          );
        used.add(findingKey);
        used.add(fingerprint);
        const quantity = item.quantity ?? 1;
        if (
          !Number.isInteger(quantity) ||
          quantity < 1 ||
          quantity > 20 ||
          price.amount.lt(0)
        )
          throw new BadRequestException('Invalid penalty quantity or amount.');
        return {
          priceId: price.id,
          code: price.code,
          category,
          configurationVersion: price.configurationVersion,
          isSpare: price.isSpare,
          evidenceRequired,
          ...(item.findingId ? { findingId: item.findingId } : {}),
          ...(price.isSpare
            ? {
                spare: {
                  name: price.name ?? price.description,
                  code: price.code,
                  origin: price.masterSpareId ? 'MASTER' : 'CLIENT',
                  masterSpareId: price.masterSpareId,
                  sourceVersion: price.sourceVersion,
                  baseRate: price.baseRate?.toFixed(2) ?? null,
                  gstPercent: price.gstPercent?.toFixed(2) ?? null,
                  hsnCode: price.hsnCode,
                  unit: price.unit,
                },
              }
            : {}),
          description: price.description,
          quantity,
          unitAmount: price.amount.toFixed(2),
          amount: price.amount.mul(quantity).toFixed(2),
          currency: price.currency,
          details: item.details.trim(),
          evidencePhotoIds,
          findingKey,
        };
      });
      const agreement = await tx.riderRentalAgreement.findFirst({
        where: { id: submission.agreementId, clientId },
        select: { currency: true },
      });
      if (
        !agreement ||
        items.some((item) => item.currency !== agreement.currency)
      )
        throw new BadRequestException(
          'Penalty currency must match the rental agreement.',
        );
      const total = items.reduce(
        (sum, item) => sum.plus(item.amount),
        new Prisma.Decimal(0),
      );
      if (total.gt('999999999999.99'))
        throw new BadRequestException(
          'Penalty total exceeds the supported amount.',
        );
      const snapshot = {
        ...condition,
        stage: input.stage,
        mechanicName: input.mechanicName.trim(),
        summary: input.summary.trim(),
        safeForReuse: input.safeForReuse,
        unsafeReason:
          input.fleetStatus === 'AVAILABLE' && input.safeForReuse
            ? null
            : input.unsafeReason!.trim(),
        checksComplete: Boolean(input.checksComplete),
        evidencePhotoIds: [...new Set(input.evidencePhotoIds)].sort(),
        items,
        totalAmount: total.toFixed(2),
        currency: agreement.currency,
      };
      const content = {
        ...snapshot,
        items: items as unknown as Prisma.InputJsonValue,
        digest: hash(snapshot),
      };
      const row = edit
        ? await tx.vehicleSubmissionReport.update({
            where: { id: edit.reportId },
            data: content,
          })
        : await tx.vehicleSubmissionReport.create({
            data: {
              clientId,
              submissionId: id,
              requestKey,
              ...content,
              recordedById: actor.id,
            },
          });
      if (input.stage === 'BASIC')
        await tx.inspection.update({
          where: { id: submission.inspectionId },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            completedBy: actor.id,
            safeForReuse: input.safeForReuse && condition.fleetStatus === 'AVAILABLE',
            unsafeReason: snapshot.unsafeReason,
          },
        });
      await this.audit(
        tx,
        clientId,
        actor.id,
        edit
          ? 'VEHICLE_MECHANIC_REPORT_EDITED'
          : 'VEHICLE_MECHANIC_REPORT_RECORDED',
        id,
        {
          reportId: row.id,
          stage: row.stage,
          proofCount: input.evidencePhotoIds.length,
          totalAmount: total.toFixed(2),
        },
      );
      return row;
    });
  }

  async updateReport(
    clientId: string,
    actor: AuthUser,
    reportId: string,
    input: MechanicReportDto,
    expectedDigest: string,
  ) {
    if (!/^[a-f0-9]{64}$/.test(expectedDigest ?? ''))
      throw new BadRequestException(
        'Supply the current report digest in If-Match.',
      );
    const { report, submission } = await this.reportAccess(
      clientId,
      actor,
      reportId,
    );
    this.assertBasicReportWrite(report.stage);
    return this.recordReport(
      clientId,
      actor,
      submission.id,
      input,
      report.requestKey,
      { reportId, expectedDigest },
    );
  }
  private assertBasicReportWrite(stage: string) {
    if (stage !== 'BASIC')
      throw new ConflictException(
        'Historical DEEP mechanic reports are read-only.',
      );
  }
  private async reportAccess(
    clientId: string,
    actor: AuthUser,
    reportId: string,
  ) {
    const report = await this.db.vehicleSubmissionReport.findFirst({
      where: { id: reportId, clientId },
    });
    if (!report) throw new NotFoundException('Mechanic report not found.');
    const submission = await this.accessible(
      this.db,
      clientId,
      actor,
      report.submissionId,
    );
    await this.staffHub(this.db, clientId, actor, submission.hubId);
    return { report, submission };
  }
  private async assertReportEvidence(
    tx: Tx,
    clientId: string,
    submission: VehicleSubmission,
    row: Prisma.VehicleSubmissionReportGetPayload<Record<string, never>>,
  ) {
    await tx.$queryRaw`SELECT id FROM "Inspection" WHERE id=${submission.inspectionId} AND "clientId"=${clientId} FOR UPDATE`;
    const frozenDigest = hash({
      ...(row.fleetStatus ? { fleetStatus: row.fleetStatus } : {}),
      stage: row.stage,
      mechanicName: row.mechanicName,
      summary: row.summary,
      safeForReuse: row.safeForReuse,
      unsafeReason: row.unsafeReason,
      checksComplete: row.checksComplete,
      evidencePhotoIds: row.evidencePhotoIds,
      items: row.items,
      totalAmount: row.totalAmount.toFixed(2),
      currency: row.currency,
    });
    if (frozenDigest !== row.digest)
      throw new ConflictException('Mechanic report changed after submission.');
    const evidenceIds = [
      ...new Set([
        ...row.evidencePhotoIds,
        ...(row.items as unknown as ItemSnapshot[]).flatMap(
          (item) => item.evidencePhotoIds,
        ),
      ]),
    ];
    const evidence = await tx.photo.count({
      where: {
        clientId,
        entityType: 'INSPECTION',
        entityId: submission.inspectionId,
        status: 'COMPLETE',
        id: { in: evidenceIds },
      },
    });
    if (evidence !== evidenceIds.length)
      throw new ConflictException(
        'Report evidence is no longer available for this submission.',
      );
  }
  private async ensurePenaltyPayment(
    tx: Tx,
    clientId: string,
    actor: AuthUser,
    submission: VehicleSubmission,
    row: Prisma.VehicleSubmissionReportGetPayload<Record<string, never>>,
  ) {
    let chargeId: string | null = null;
    let paymentRequest: ReturnType<typeof paymentView> | null = null;
    if (row.totalAmount.gt(0)) {
      await tx.$queryRaw`SELECT id FROM "Rider" WHERE id = ${submission.riderId} AND "clientId" = ${clientId} FOR UPDATE`;
      const charge = await this.billing.issueChargeInTransaction(
        tx,
        clientId,
        submission.riderId,
        actor.id,
        `return-penalty:submission-report:${row.id}`,
        {
          chargeType: 'RETURN_PENALTY',
          description: `${row.stage === 'BASIC' ? 'Initial' : 'Additional'} vehicle submission penalties`,
          quantity: '1',
          unitAmount: row.totalAmount.toFixed(2),
          currency: row.currency,
          referenceType: 'VEHICLE_SUBMISSION_REPORT',
          referenceId: row.id,
        },
        undefined,
        {
          agreementId: submission.agreementId,
          vehicleId: submission.fleetId,
        },
      );
      chargeId = charge.id;
      paymentRequest = paymentView(
        await invoiceSubmissionPenalty(tx, clientId, row, charge.id, actor.id),
      );
    }
    return { chargeId, paymentRequest };
  }
  async impose(clientId: string, actor: AuthUser, reportId: string) {
    const { report, submission } = await this.reportAccess(
      clientId,
      actor,
      reportId,
    );
    this.assertBasicReportWrite(report.stage);
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "VehicleSubmissionReport" WHERE id=${reportId} AND "clientId"=${clientId} FOR UPDATE`;
      const row = await tx.vehicleSubmissionReport.findFirstOrThrow({
        where: { id: reportId, clientId },
      });
      if (!['DRAFT', 'SUBMITTED', 'POSTED'].includes(row.status))
        throw new ConflictException(
          'Report is no longer available for imposition.',
        );
      if (row.status === 'POSTED') {
        const invoice = await tx.riderInvoice.findUnique({
          where: {
            clientId_sourceKey: {
              clientId,
              sourceKey: `submission-penalty:${row.id}`,
            },
          },
        });
        return {
          ...row,
          paymentRequest: invoice ? paymentView(invoice) : null,
          paymentRequiredToCompleteSubmission: false,
        };
      }
      if (row.status === 'DRAFT')
        await this.assertReportEvidence(tx, clientId, submission, row);
      const { chargeId, paymentRequest } = await this.ensurePenaltyPayment(
        tx,
        clientId,
        actor,
        submission,
        row,
      );
      const updated = await tx.vehicleSubmissionReport.update({
        where: { id: reportId },
        data: {
          status: 'SUBMITTED',
          postedChargeId: chargeId,
          ...(row.status === 'DRAFT'
            ? { imposedById: actor.id, imposedAt: new Date() }
            : {}),
        },
      });
      if (row.status === 'DRAFT')
        await this.audit(
          tx,
          clientId,
          actor.id,
          'VEHICLE_PENALTIES_IMPOSED',
          submission.id,
          { reportId, digest: row.digest, amount: row.totalAmount.toFixed(2) },
        );
      return {
        ...updated,
        paymentRequest,
        paymentRequiredToCompleteSubmission: false,
      };
    });
  }
  private async recipients(db: Tx, submission: VehicleSubmission) {
    const rider = await db.rider.findFirst({
      where: {
        id: submission.riderId,
        clientId: submission.clientId,
        deletedAt: null,
      },
      select: { userId: true, mobile: true },
    });
    if (!rider) throw new NotFoundException('Rider not found.');
    const teamLeads = await db.teamLeaderRider.findMany({
      where: {
        clientId: submission.clientId,
        riderId: submission.riderId,
        isActive: true,
        removedAt: null,
        isPrimary: true,
        teamLeader: {
          deletedAt: null,
          user: {
            clientId: submission.clientId,
            role: 'TEAM_LEAD',
            isActive: true,
            deletedAt: null,
          },
        },
      },
      include: { teamLeader: { include: { user: true } } },
      orderBy: { assignedAt: 'desc' },
    });
    return {
      rider: {
        id: rider.userId ?? submission.riderId,
        phone: normalizeIndianMobile(rider.mobile),
      },
      teamLead:
        teamLeads.length === 1
          ? {
              id: teamLeads[0]!.teamLeader.user.id,
              phone: normalizeIndianMobile(
                teamLeads[0]!.teamLeader.user.mobile,
              ),
            }
          : null,
    };
  }
  async requestOtps(
    clientId: string,
    actor: AuthUser,
    reportId: string,
    party: 'BOTH' | 'RIDER' | 'TEAM_LEAD',
  ) {
    const { report, submission } = await this.reportAccess(
      clientId,
      actor,
      reportId,
    );
    this.assertBasicReportWrite(report.stage);
    if (report.status !== 'SUBMITTED')
      throw new ConflictException('Impose the report before requesting OTPs.');
    const recipients = await this.recipients(this.db, submission);
    const parties =
      party === 'BOTH' ? (['RIDER', 'TEAM_LEAD'] as const) : [party];
    const results = await Promise.all(
      parties.map(async (selected) => {
        const recipient =
          selected === 'RIDER' ? recipients.rider : recipients.teamLead;
        if (!recipient)
          return {
            party: selected,
            available: false,
            message:
              'No single active primary team lead is assigned. Record a team lead bypass reason if necessary.',
          };
        try {
          return {
            party: selected,
            available: true,
            phone: `******${recipient.phone.slice(-4)}`,
            ...(await this.auth.requestVehicleSubmissionOtp(
              clientId,
              reportId,
              report.digest,
              selected,
              recipient.id,
              recipient.phone,
            )),
          };
        } catch (cause) {
          return {
            party: selected,
            available: true,
            error:
              cause instanceof Error ? cause.message : 'OTP could not be sent.',
          };
        }
      }),
    );
    return {
      reportId,
      amount: report.totalAmount.toFixed(2),
      currency: report.currency,
      recipients: results,
      guidance,
    };
  }
  async verifyOtp(
    clientId: string,
    actor: AuthUser,
    reportId: string,
    party: 'RIDER' | 'TEAM_LEAD',
    requestId: string,
    code: string,
  ) {
    const { report, submission } = await this.reportAccess(
      clientId,
      actor,
      reportId,
    );
    this.assertBasicReportWrite(report.stage);
    const recipients = await this.recipients(this.db, submission);
    const recipient =
      party === 'RIDER' ? recipients.rider : recipients.teamLead;
    if (!recipient)
      throw new ConflictException(
        'No unique active primary team lead is available.',
      );
    return this.auth.verifyVehicleSubmissionOtp(
      clientId,
      requestId,
      code,
      {
        reportId,
        digest: report.digest,
        party,
        recipientId: recipient.id,
        phone: recipient.phone,
      },
      actor.id,
    );
  }

  async confirm(
    clientId: string,
    actor: AuthUser,
    reportId: string,
    input: ConfirmSubmissionReportDto,
  ) {
    const { report, submission } = await this.reportAccess(
      clientId,
      actor,
      reportId,
    );
    this.assertBasicReportWrite(report.stage);
    const bypass = Boolean(
      input.riderBypassReason || input.teamLeadBypassReason,
    );
    if (bypass && !actor.roles.includes('FLEET_MANAGER'))
      throw new ForbiddenException(
        'Only a fleet manager may bypass submission OTPs.',
      );
    for (const reason of [input.riderBypassReason, input.teamLeadBypassReason])
      if (
        reason !== undefined &&
        (!reason.trim() || reason.trim().length > 500)
      )
        throw new BadRequestException('A nonblank bypass reason is required.');
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "VehicleSubmissionReport" WHERE id=${reportId} AND "clientId"=${clientId} FOR UPDATE`;
      const row = await tx.vehicleSubmissionReport.findFirst({
        where: { id: reportId, clientId, submissionId: submission.id },
      });
      if (!row) throw new NotFoundException('Report not found.');
      if (row.status === 'POSTED') {
        const invoice = await tx.riderInvoice.findUnique({
          where: {
            clientId_sourceKey: {
              clientId,
              sourceKey: `submission-penalty:${row.id}`,
            },
          },
        });
        return {
          ...row,
          paymentRequest: invoice ? paymentView(invoice) : null,
          paymentRequiredToCompleteSubmission: false,
        };
      }
      if (row.status !== 'SUBMITTED')
        throw new ConflictException(
          'Report must be imposed before confirmation.',
        );
      await this.assertReportEvidence(tx, clientId, submission, row);
      const recipients = await this.recipients(tx, submission);
      const riderConfirmed =
        row.riderOtpRequestId &&
        row.riderVerifiedUserId === recipients.rider.id;
      const leadConfirmed =
        row.teamLeadOtpRequestId &&
        row.teamLeadVerifiedUserId === recipients.teamLead?.id;
      if (!riderConfirmed && !input.riderBypassReason?.trim())
        throw new ConflictException(
          'Rider OTP or a fleet manager bypass reason is required.',
        );
      if (!leadConfirmed && !input.teamLeadBypassReason?.trim())
        throw new ConflictException(
          'Team lead OTP or a fleet manager bypass reason is required.',
        );
      // Verify stored confirmations were issued for this exact, immutable report.
      for (const [party, otpId, confirmed] of [
        ['RIDER', row.riderOtpRequestId, riderConfirmed],
        ['TEAM_LEAD', row.teamLeadOtpRequestId, leadConfirmed],
      ] as const) {
        if (!confirmed) continue;
        const otp = await tx.otpRequest.findFirst({
          where: {
            id: otpId!,
            clientId,
            status: 'VERIFIED',
            purpose:
              party === 'RIDER'
                ? 'VEHICLE_SUBMISSION_RIDER'
                : 'VEHICLE_SUBMISSION_TEAM_LEAD',
          },
        });
        const context = otp?.context as Record<string, unknown> | null;
        if (
          !context ||
          context.reportId !== row.id ||
          context.digest !== row.digest ||
          context.party !== party ||
          context.recipientId !==
            (party === 'RIDER'
              ? recipients.rider.id
              : recipients.teamLead?.id) ||
          otp?.phone !==
            (party === 'RIDER'
              ? recipients.rider.phone
              : recipients.teamLead?.phone)
        )
          throw new ConflictException(
            'OTP confirmation is stale. Request a new OTP.',
          );
      }
      await tx.$queryRaw`SELECT id FROM "Fleet" WHERE id=${submission.fleetId} AND "clientId"=${clientId} FOR UPDATE`;
      if (await tx.allocation.count({ where: { clientId, fleetId: submission.fleetId,
        id: { not: submission.allocationId }, status: { notIn: ['COMPLETED', 'CANCELLED'] } } }))
        throw new ConflictException('Vehicle has another active allocation; this submission cannot change its condition.');
      const previousFleet = await tx.fleet.findUniqueOrThrow({ where: { id: submission.fleetId }, select: { status: true, allocationBlockedByAdmin: true } });
      const { chargeId, paymentRequest } = await this.ensurePenaltyPayment(
        tx,
        clientId,
        actor,
        submission,
        row,
      );
      const now = new Date();
      const result = await tx.vehicleSubmissionReport.update({
        where: { id: row.id },
        data: {
          status: 'POSTED',
          postedChargeId: chargeId,
          confirmedAt: now,
          confirmedById: actor.id,
          riderBypassReason: riderConfirmed
            ? null
            : input.riderBypassReason!.trim(),
          teamLeadBypassReason: leadConfirmed
            ? null
            : input.teamLeadBypassReason!.trim(),
        },
      });
      await tx.vehicleSubmission.update({
        where: { id: submission.id },
        data: {
          ...(row.stage === 'BASIC'
            ? { status: 'CONFIRMED', confirmedAt: now, confirmedById: actor.id }
            : {}),
          mechanicChecksComplete: true,
        },
      });
      if (row.stage === 'BASIC')
        await this.completePhysicalSubmission(
          tx,
          clientId,
          actor,
          submission,
          now,
        );
      if (!row.checksComplete || !row.safeForReuse || (row.fleetStatus && row.fleetStatus !== 'AVAILABLE'))
        await tx.fleet.update({
          where: { id: submission.fleetId },
          data: { status: row.fleetStatus && row.fleetStatus !== 'AVAILABLE' ? row.fleetStatus : 'MAINTENANCE', allocationEnabled: false, readinessApprovedPreparationId: null },
        });
      else {
        const active = await tx.allocation.count({
          where: {
            clientId,
            fleetId: submission.fleetId,
            status: {
              in: [
                'ACTIVE',
                'INITIATED',
                'INSPECTION_PENDING',
                'OTP_PENDING',
                'DEALLOCATION_INITIATED',
              ],
            },
          },
        });
        if (active)
          throw new ConflictException(
            'Vehicle has another active allocation and cannot be released by this report.',
          );
        const readinessClient = await tx.client.findUniqueOrThrow({
          where: { id: clientId },
          select: { fleetOperatingMode: true },
        });
        await tx.fleet.update({
          where: { id: submission.fleetId },
          data: {
            status: 'AVAILABLE',
            ...(['PREPARATION_QC', 'STAGED_PREPARATION_QC'].includes(
              readinessClient.fleetOperatingMode,
            )
              ? { allocationEnabled: false, readinessApprovedPreparationId: null }
              : { allocationEnabled: !previousFleet.allocationBlockedByAdmin }),
          },
        });
      }
      const finalFleet = await tx.fleet.findUniqueOrThrow({ where: { id: submission.fleetId }, select: { status: true } });
      await tx.fleetStatusHistory.create({ data: {
        fleetId: submission.fleetId, fromStatus: previousFleet.status, toStatus: finalFleet.status,
        changedByUserId: actor.id, reason: `Submission report ${row.id}: ${row.summary}`.slice(0, 255),
      } });
      await tx.otpRequest.updateMany({
        where: {
          clientId,
          purpose: {
            in: ['VEHICLE_SUBMISSION_RIDER', 'VEHICLE_SUBMISSION_TEAM_LEAD'],
          },
          status: 'PENDING',
          context: { path: ['reportId'], equals: row.id },
        },
        data: { status: 'CANCELLED' },
      });
      await this.audit(
        tx,
        clientId,
        actor.id,
        bypass
          ? 'VEHICLE_SUBMISSION_OTP_BYPASSED'
          : 'VEHICLE_SUBMISSION_CONFIRMED',
        submission.id,
        {
          reportId: row.id,
          chargeId,
          amount: row.totalAmount.toFixed(2),
          riderBypassReason: result.riderBypassReason,
          teamLeadBypassReason: result.teamLeadBypassReason,
          checksComplete: row.checksComplete,
          fleetStatus: finalFleet.status,
          previousFleetStatus: previousFleet.status,
        },
      );
      return {
        ...result,
        paymentRequest,
        paymentRequiredToCompleteSubmission: false,
      };
    });
  }

  private async completePhysicalSubmission(
    tx: Tx,
    clientId: string,
    actor: AuthUser,
    submission: VehicleSubmission,
    now: Date,
  ) {
    if (submission.returnRequestId) {
      const request = await tx.rentalTerminationRequest.findFirst({
        where: {
          id: submission.returnRequestId,
          clientId,
          status: 'REQUESTED',
          allocationId: submission.allocationId,
        },
        include: { agreement: true },
      });
      if (
        !request ||
        !['ACTIVE', 'SUSPENDED', 'TERMINATION_PENDING'].includes(
          request.agreement.status,
        )
      )
        throw new ConflictException(
          'Return request or rental agreement changed.',
        );
      if (request.agreement.startDate && now < request.agreement.startDate)
        throw new ConflictException(
          'Cannot return before the agreement starts.',
        );
      await tx.rentalTerminationRequest.update({
        where: { id: request.id },
        data: {
          status: 'RETURNED',
          receivedHubId: submission.hubId,
          actualTerminationDate: now,
          receiptRecordedAt: now,
          receiptRecordedById: actor.id,
        },
      });
      await tx.riderRentalAgreement.update({
        where: { id: submission.agreementId },
        data: {
          status: 'TERMINATED',
          commercialClosureState: 'FINAL_BILLING_PENDING',
          terminationEffectiveAt: now,
          terminatedAt: now,
          updatedById: actor.id,
        },
      });
      await tx.riderRentalAgreementStatusHistory.create({
        data: {
          clientId,
          agreementId: submission.agreementId,
          previousStatus: request.agreement.status,
          newStatus: 'TERMINATED',
          reason: 'VEHICLE_RETURN',
          changedById: actor.id,
        },
      });
    } else if (submission.exchangeRequestId) {
      const exchange = await tx.vehicleExchangeRequest.findFirst({
        where: {
          id: submission.exchangeRequestId,
          clientId,
          status: 'RETURN_PENDING',
          oldAllocationId: submission.allocationId,
        },
      });
      if (!exchange) throw new ConflictException('Exchange state changed.');
      const changed = await tx.riderRentalAgreement.updateMany({
        where: {
          id: submission.agreementId,
          clientId,
          status: 'ACTIVE',
          currentVehicleId: submission.fleetId,
          currentCommercialVersionNumber: exchange.baseVersionNumber,
        },
        data: { currentVehicleId: null, updatedById: actor.id },
      });
      if (!changed.count)
        throw new ConflictException('Exchange agreement version changed.');
      await tx.vehicleExchangeRequest.update({
        where: { id: exchange.id },
        data: {
          status: 'APPROVED',
          returnInspectionId: submission.inspectionId,
          updatedById: actor.id,
        },
      });
    } else throw new ConflictException('Submission has no source request.');
    await tx.allocation.update({
      where: { id: submission.allocationId },
      data: { deallocatedAt: now },
    });
    await this.allocations.completeDeallocationInTransaction(
      tx,
      clientId,
      submission.allocationId,
    );
    await tx.fleet.update({
      where: { id: submission.fleetId },
      data: { currentHubId: submission.hubId },
    });
  }

  async cancelReport(
    clientId: string,
    actor: AuthUser,
    reportId: string,
    reason: string,
  ) {
    const { report, submission } = await this.reportAccess(
      clientId,
      actor,
      reportId,
    );
    if (!reason.trim())
      throw new BadRequestException('Cancellation reason is required.');
    return this.transaction(async (tx) => {
      const changed = await tx.vehicleSubmissionReport.updateMany({
        where: {
          id: reportId,
          clientId,
          status: { in: ['DRAFT', 'SUBMITTED'] },
          postedChargeId: null,
        },
        data: {
          status: 'CANCELLED',
          cancelledById: actor.id,
          cancellationReason: reason.trim(),
        },
      });
      if (!changed.count)
        throw new ConflictException(
          'An imposed financial charge or posted report cannot be cancelled. Use the financial adjustment process.',
        );
      if (report.stage === 'BASIC')
        await tx.inspection.update({
          where: { id: submission.inspectionId },
          data: {
            status: 'DRAFT',
            completedAt: null,
            completedBy: null,
            safeForReuse: null,
            unsafeReason: null,
          },
        });
      await tx.otpRequest.updateMany({
        where: {
          clientId,
          status: 'PENDING',
          purpose: {
            in: ['VEHICLE_SUBMISSION_RIDER', 'VEHICLE_SUBMISSION_TEAM_LEAD'],
          },
          context: { path: ['reportId'], equals: reportId },
        },
        data: { status: 'CANCELLED' },
      });
      await this.audit(
        tx,
        clientId,
        actor.id,
        'VEHICLE_MECHANIC_REPORT_CANCELLED',
        submission.id,
        { reportId, reason: reason.trim() },
      );
      return tx.vehicleSubmissionReport.findUniqueOrThrow({
        where: { id: reportId },
      });
    });
  }
}
