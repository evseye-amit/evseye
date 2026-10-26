import { recordSpareRevision } from '../spares/spares-copy.js';
import { plannedDate, selectSubmissionHub } from '../vehicle-submissions/submission-hub.js';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AllocationStatus,
  FleetStatus,
  InspectionStatus,
  InspectionType,
  Prisma,
  UserRole,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { AllocationsService } from '../allocations/allocations.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RiderBillingService } from '../rider-billing/rider-billing.service.js';
import type {
  CreateRideReturnDto,
  DisputeReturnPenaltyDto,
  ReceiveRideReturnDto,
  ReplaceReturnPenaltiesDto,
  ReturnPenaltyPriceDto,
  UpdateReturnPenaltyPriceDto,
} from './dto/ride-return.dto.js';

type Tx = Prisma.TransactionClient;
type RequestSource = 'RIDER' | 'STAFF';
type RequestInput = CreateRideReturnDto & { agreementId?: string };
type PenaltyItemInput = ReplaceReturnPenaltiesDto['items'][number];

const RETURNABLE_AGREEMENTS = new Set(['ACTIVE', 'SUSPENDED', 'TERMINATION_PENDING']);
const PENALTY_CATEGORIES = new Set(['DAMAGE', 'MISSING_ITEM']);
const money = (value: Prisma.Decimal) => value.toFixed(2);
const fail = (code: string, message = code): never => {
  throw new ConflictException({ code, message });
};

function parseDate(value: string, message: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(message);
  return date;
}

function digestFor(
  caseId: string,
  revision: number,
  items: readonly {
    position: number;
    priceCode: string;
    category: string;
    description: string;
    amount: string;
    currency: string;
    details: string;
    evidencePhotoIds: readonly string[];
  }[],
  totalAmount: string,
) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        caseId,
        revision,
        items: items.map((item) => ({
          ...item,
          evidencePhotoIds: [...item.evidencePhotoIds].sort(),
        })),
        totalAmount,
      }),
    )
    .digest('hex');
}

@Injectable()
export class RideReturnsService {
  constructor(
    private readonly db: PrismaService,
    private readonly allocations: AllocationsService,
    private readonly billing: RiderBillingService,
  ) {}

  private async serializable<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 20000,
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          attempt < 3
        )
          continue;
        throw error;
      }
    }
  }

  private audit(
    tx: Tx,
    clientId: string,
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    newData?: Record<string, unknown>,
  ) {
    return tx.auditLog.create({
      data: {
        clientId,
        actorId,
        action,
        entityType,
        entityId,
        newData: newData ? (newData as Prisma.InputJsonValue) : undefined,
      },
    });
  }

  private fleetScoped(user: AuthUser) {
    return (
      user.roles.includes(UserRole.FLEET_MANAGER) &&
      !user.roles.includes(UserRole.CLIENT_ADMIN)
    );
  }

  private async hubIds(clientId: string, userId: string) {
    return (
      await this.db.userHub.findMany({
        where: { clientId, userId, hub: { clientId, status: 'ACTIVE', deletedAt: null } },
        select: { hubId: true },
      })
    ).map((row) => row.hubId);
  }

  private async assertHubAccess(
    clientId: string,
    user: AuthUser,
    hubId: string | null | undefined,
  ) {
    if (!this.fleetScoped(user)) return;
    if (!hubId || !(await this.hubIds(clientId, user.id)).includes(hubId))
      throw new NotFoundException('Return is not in an assigned Hub.');
  }

  private async riderForUser(clientId: string, userId: string) {
    const rider = await this.db.rider.findFirst({
      where: { clientId, userId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!rider) throw new NotFoundException('Rider profile not found.');
    if (rider.status !== 'ACTIVE') throw new ForbiddenException('Rider account is not active.');
    return rider;
  }

  private async assertStaffReturnAccess(
    clientId: string,
    user: AuthUser,
    requestId: string,
  ) {
    const request = await this.db.rentalTerminationRequest.findFirst({
      where: { id: requestId, clientId },
      select: { id: true, plannedHubId: true, receivedHubId: true },
    });
    if (!request) throw new NotFoundException('Return not found.');
    if (this.fleetScoped(user)) {
      const hubs = await this.hubIds(clientId, user.id);
      const scopedHub = [request.plannedHubId, request.receivedHubId].some(
        (hubId) => hubId !== null && hubs.includes(hubId),
      );
      if (!scopedHub)
        throw new NotFoundException('Return is not in an assigned Hub.');
    }
    return request;
  }

  async request(
    clientId: string,
    actor: AuthUser,
    input: RequestInput,
    key: string,
    source: RequestSource,
  ) {
    if (!key || !/^[A-Za-z0-9:_-]{8,120}$/.test(key))
      throw new BadRequestException('An Idempotency-Key is required.');
    const reasonCode = input.reasonCode === undefined && source === 'RIDER' ? 'VEHICLE_RETURN' : typeof input.reasonCode === 'string' ? input.reasonCode.trim() : '';
    if (!reasonCode) throw new BadRequestException('A return reason is required.');
    const requested = plannedDate(input.plannedReturnDate, true);
    const rider = source === 'RIDER'
      ? await this.riderForUser(clientId, actor.id)
      : input.riderId
        ? await this.db.rider.findFirst({
            where: { id: input.riderId, clientId, deletedAt: null },
            select: { id: true, status: true },
          })
        : null;
    if (!rider) throw new BadRequestException('riderId is required for a staff request.');
    if (rider.status !== 'ACTIVE') throw new ConflictException('Rider account is not active.');
    if (source === 'RIDER' && input.riderId && input.riderId !== rider.id)
      throw new ForbiddenException('A rider can only return their own vehicle.');

    if (!input.plannedHubId) {
      // An idempotent retry keeps the originally selected hub even if the vehicle moves.
      const retry = await this.db.rentalTerminationRequest.findUnique({ where: { clientId_idempotencyKey: { clientId, idempotencyKey: key } } });
      if (retry && retry.riderId !== rider.id) throw new NotFoundException('Return request not found.');
      if (retry?.status !== 'CANCELLED' && retry?.plannedHubId) input = { ...input, plannedHubId: retry.plannedHubId };
      else {
        const allocation = await this.db.allocation.findFirst({ where: { clientId, riderId: rider.id, status: 'ACTIVE' }, orderBy: { allocatedAt: 'desc' }, select: { fleetId: true } });
        if (!allocation) throw new ConflictException({ code: 'ACTIVE_ALLOCATION_REQUIRED', message: 'You do not have an active scooter allocation to return.' });
        input = { ...input, plannedHubId: (await selectSubmissionHub(this.db, clientId, allocation.fleetId, undefined, input)).hub.id };
      }
    }
    await this.assertHubAccess(clientId, actor, input.plannedHubId);
    const hub = await this.db.hub.findFirst({
      where: { id: input.plannedHubId, clientId, deletedAt: null, status: 'ACTIVE', supportsDeallocation: true },
      select: { id: true },
    });
    if (!hub) throw new NotFoundException('Planned Hub not found.');

    return this.serializable(async (tx) => {
      const reasonText = input.notes?.trim() || null;
      const existingByKey = await tx.rentalTerminationRequest.findUnique({
        where: { clientId_idempotencyKey: { clientId, idempotencyKey: key } },
      });
      if (existingByKey) {
        if (existingByKey.riderId !== rider.id || (input.agreementId && input.agreementId !== existingByKey.agreementId))
          fail('RETURN_ALREADY_REQUESTED');
        if (existingByKey.status !== 'CANCELLED') {
          if (
            existingByKey.requestedTerminationDate.getTime() !== requested.getTime() ||
            existingByKey.reasonCode !== reasonCode ||
            existingByKey.reasonText !== reasonText ||
            existingByKey.plannedHubId !== input.plannedHubId
          )
            fail('RETURN_ALREADY_REQUESTED');
          if (source === 'STAFF' && this.fleetScoped(actor)) {
            const allocation = await tx.allocation.findFirst({
              where: { id: existingByKey.allocationId ?? '', clientId, riderId: rider.id },
              include: { fleet: { select: { currentHubId: true } } },
            });
            await this.assertHubAccess(clientId, actor, allocation?.fleet.currentHubId);
          }
          return existingByKey;
        }
      }

      if (source === 'RIDER') plannedDate(input.plannedReturnDate);
      const agreementId = input.agreementId ?? existingByKey?.agreementId;
      const agreements = await tx.riderRentalAgreement.findMany({
        where: agreementId
          ? { id: agreementId, clientId, riderId: rider.id }
          : {
              clientId,
              riderId: rider.id,
              status: { in: ['ACTIVE', 'SUSPENDED', 'TERMINATION_PENDING'] },
            },
      });
      if (!agreements.length) {
        if (agreementId) throw new NotFoundException('Agreement not found.');
        const active = await tx.allocation.findMany({ where: { clientId, riderId: rider.id, status: 'ACTIVE' } });
        if (!active.length) throw new ConflictException({ code: 'ACTIVE_ALLOCATION_REQUIRED', message: 'You do not have an active scooter allocation to return.' });
        if (active.some(a => !a.rentalAgreementId)) throw new ConflictException({ code: 'RENTAL_PLAN_REQUIRED', message: 'The scooter allocation has no attached rental plan. Ask the fleet manager to check the allocation setup.' });
        throw new ConflictException({ code: 'RENTAL_AGREEMENT_NOT_ACTIVE', message: 'Your scooter allocation has no active rental agreement. Ask the fleet manager to check the allocation setup.' });
      }
      if (agreementId && !RETURNABLE_AGREEMENTS.has(agreements[0].status)) fail('RENTAL_AGREEMENT_NOT_ACTIVE', 'The rental agreement is not active for scooter return. Ask the fleet manager to check the allocation setup.');

      const fleetIds = agreements.map((candidate) => candidate.currentVehicleId ?? candidate.vehicleId);
      const allocations = await tx.allocation.findMany({
        where: {
          clientId,
          riderId: rider.id,
          status: 'ACTIVE',
          fleetId: agreementId ? fleetIds[0] : { in: fleetIds },
        },
        include: { fleet: { select: { currentHubId: true } } },
      });
      const matches = agreements.flatMap((candidate) => {
        const fleetId = candidate.currentVehicleId ?? candidate.vehicleId;
        return allocations
          .filter((candidateAllocation) => candidateAllocation.fleetId === fleetId && candidateAllocation.rentalAgreementId === candidate.id)
          .map((candidateAllocation) => ({ agreement: candidate, allocation: candidateAllocation }));
      });
      if (!matches.length) throw new ConflictException({
        code: allocations.length ? 'ALLOCATION_AGREEMENT_MISMATCH' : 'ACTIVE_ALLOCATION_REQUIRED',
        message: allocations.length ? 'The scooter allocation is not linked to this rental agreement. Ask the fleet manager to check the allocation setup.' : 'You do not have an active allocation for this rental scooter.',
      });
      if (matches.length > 1) fail('MULTIPLE_ACTIVE_RENTALS', 'Multiple active rentals prevent automatic resolution.');
      const [{ agreement, allocation }] = matches;
      if (source === 'STAFF')
        await this.assertHubAccess(clientId, actor, allocation.fleet.currentHubId);
      if (await tx.vehicleExchangeRequest.findFirst({ where: { clientId, oldAllocationId: allocation.id, status: { in: ['REQUESTED', 'APPROVED', 'REPLACEMENT_SELECTED', 'OFFER_PRESENTED', 'ACCEPTED', 'RETURN_PENDING', 'DEPOSIT_PENDING', 'HANDOVER_PENDING'] } } })) throw new ConflictException('An exchange is already requested for this vehicle.');
      const existing = existingByKey ?? await tx.rentalTerminationRequest.findUnique({
        where: { agreementId: agreement.id },
      });
      if (existing && existing.status !== 'CANCELLED') {
        if (
          existing.idempotencyKey !== key ||
          existing.requestedTerminationDate.getTime() !== requested.getTime() ||
          existing.reasonCode !== reasonCode ||
          existing.reasonText !== reasonText ||
          existing.plannedHubId !== input.plannedHubId ||
          existing.riderId !== rider.id
        )
          fail('RETURN_ALREADY_REQUESTED');
        return existing;
      }
      const row = existing
        ? await tx.rentalTerminationRequest.update({
            where: { id: existing.id },
            data: {
              allocationId: allocation.id,
              submissionRequired: true,
              plannedHubId: input.plannedHubId,
              receivedHubId: null,
              requestedTerminationDate: requested,
              actualTerminationDate: null,
              reasonCode,
              reasonText,
              requestedById: actor.id,
              requestSource: source,
              cancelledAt: null,
              cancelledById: null,
              receiptRecordedAt: null,
              receiptRecordedById: null,
              receiptBackdateReason: null,
              status: 'REQUESTED',
              idempotencyKey: key,
            },
          })
        : await tx.rentalTerminationRequest.create({
            data: {
              clientId,
              riderId: rider.id,
              agreementId: agreement.id,
              allocationId: allocation.id,
              plannedHubId: input.plannedHubId,
              requestedTerminationDate: requested,
              reasonCode,
              reasonText: input.notes?.trim() || null,
              requestedById: actor.id,
              requestSource: source,
              idempotencyKey: key,
            },
          });
      await this.audit(tx, clientId, actor.id, 'RENTAL_TERMINATION_REQUESTED', 'RentalTerminationRequest', row.id, {
        agreementId: agreement.id,
        source,
        plannedHubId: input.plannedHubId,
      });
      return row;
    });
  }

  async legacyRequest(
    clientId: string,
    agreementId: string,
    actorId: string,
    key: string,
    input: { requestedTerminationDate: string; reasonCode: string; reasonText?: string },
  ) {
    const agreement = await this.db.riderRentalAgreement.findFirst({
      where: { id: agreementId, clientId },
      select: { riderId: true, currentVehicleId: true, vehicleId: true },
    });
    if (!agreement) throw new NotFoundException('Agreement not found.');
    const allocation = await this.db.allocation.findFirst({
      where: {
        clientId,
        riderId: agreement.riderId,
        fleetId: agreement.currentVehicleId ?? agreement.vehicleId,
        status: 'ACTIVE',
      },
      include: { fleet: { select: { currentHubId: true } } },
    });
    if (!allocation?.fleet.currentHubId) throw new ConflictException('RETURN_HUB_REQUIRED');
    return this.request(
      clientId,
      { id: actorId, clientId, roles: [UserRole.FLEET_MANAGER] },
      {
        agreementId,
        riderId: agreement.riderId,
        reasonCode: input.reasonCode,
        plannedHubId: allocation.fleet.currentHubId,
        plannedReturnDate: input.requestedTerminationDate,
        notes: input.reasonText,
      },
      key,
      'STAFF',
    );
  }

  async legacyReceive(clientId: string, agreementId: string, actorId: string) {
    const agreement = await this.db.riderRentalAgreement.findFirst({
      where: { id: agreementId, clientId },
      select: { riderId: true, currentVehicleId: true, vehicleId: true },
    });
    if (!agreement) throw new NotFoundException('Agreement not found.');

    let request = await this.db.rentalTerminationRequest.findFirst({
      where: { agreementId, clientId },
    });
    if (request && request.riderId !== agreement.riderId)
      throw new NotFoundException('Termination request not found.');
    if (request?.status === 'RETURNED') return request;

    const allocation = await this.db.allocation.findFirst({
      where: {
        ...(request?.allocationId ? { id: request.allocationId } : {}),
        clientId,
        riderId: agreement.riderId,
        fleetId: agreement.currentVehicleId ?? agreement.vehicleId,
        ...(request?.allocationId
          ? {}
          : {
              status: {
                in: [
                  AllocationStatus.ACTIVE,
                  AllocationStatus.DEALLOCATION_INITIATED,
                  AllocationStatus.COMPLETED,
                ],
              },
            }),
      },
      orderBy: request?.allocationId ? undefined : { deallocatedAt: 'desc' },
      include: { fleet: { select: { currentHubId: true } } },
    });

    if (!allocation) {
      if (request) throw new ConflictException('RETURN_ALLOCATION_NOT_FOUND');
      throw new ConflictException('RETURN_HUB_REQUIRED');
    }
    if (allocation.status === AllocationStatus.COMPLETED) {
      if (!request) throw new NotFoundException('Termination request not found.');
      return this.completeLegacyRecordedReturn(
        clientId,
        agreementId,
        actorId,
        request.id,
        allocation.id,
      );
    }

    if (!request) {
      if (allocation.status !== AllocationStatus.ACTIVE)
        throw new NotFoundException('Termination request not found.');
      request = await this.legacyRequest(clientId, agreementId, actorId, `legacy-return-${agreementId}`, {
        requestedTerminationDate: new Date().toISOString(),
        reasonCode: 'VEHICLE_RETURN',
      });
    }

    const receivedHubId = request.receivedHubId ?? allocation.fleet.currentHubId ?? request.plannedHubId;
    if (!receivedHubId) throw new ConflictException('RETURN_HUB_REQUIRED');
    return this.receive(
      clientId,
      { id: actorId, clientId, roles: [UserRole.FLEET_MANAGER] },
      request.id,
      { receivedHubId },
    );
  }

  private async completeLegacyRecordedReturn(
    clientId: string,
    agreementId: string,
    actorId: string,
    requestId: string,
    allocationId: string,
  ) {
    return this.serializable(async (tx) => {
      const agreement = await tx.riderRentalAgreement.findFirst({
        where: { id: agreementId, clientId },
      });
      const request = await tx.rentalTerminationRequest.findFirst({
        where: { id: requestId, clientId, agreementId },
      });
      if (!agreement || !request || request.riderId !== agreement.riderId)
        throw new NotFoundException('Termination request not found.');
      if (request.status === 'RETURNED') return request;
      if (request.status !== 'REQUESTED') fail('RETURN_NOT_RECEIVABLE');
      if (request.submissionRequired) throw new ConflictException('Complete vehicle photos, mechanic report and rider/team lead OTPs or recorded bypasses through the vehicle submission workflow first.');

      const allocation = await tx.allocation.findFirst({
        where: {
          id: allocationId,
          clientId,
          riderId: agreement.riderId,
          fleetId: agreement.currentVehicleId ?? agreement.vehicleId,
          status: AllocationStatus.COMPLETED,
          deallocatedAt: { not: null },
        },
        include: {
          inspections: {
            where: {
              type: InspectionType.POST_DEALLOCATION,
              status: InspectionStatus.COMPLETED,
            },
            select: { id: true },
          },
        },
      });
      if (!allocation?.deallocatedAt || !allocation.inspections.length)
        throw new ConflictException('VEHICLE_RETURN_INSPECTION_REQUIRED');
      if (agreement.startDate && allocation.deallocatedAt < agreement.startDate)
        fail('RETURN_BEFORE_AGREEMENT');

      const recordedAt = new Date();
      const row = await tx.rentalTerminationRequest.update({
        where: { id: request.id },
        data: {
          status: 'RETURNED',
          allocationId: allocation.id,
          actualTerminationDate: allocation.deallocatedAt,
          receiptRecordedAt: recordedAt,
          receiptRecordedById: actorId,
        },
      });
      await tx.riderRentalAgreement.update({
        where: { id: agreementId },
        data: {
          status: 'TERMINATED',
          commercialClosureState: 'FINAL_BILLING_PENDING',
          terminationEffectiveAt: allocation.deallocatedAt,
          terminatedAt: recordedAt,
          updatedById: actorId,
        },
      });
      await tx.riderRentalAgreementStatusHistory.create({
        data: {
          clientId,
          agreementId,
          previousStatus: agreement.status,
          newStatus: 'TERMINATED',
          reason: 'VEHICLE_RETURN',
          changedById: actorId,
        },
      });
      await this.audit(
        tx,
        clientId,
        actorId,
        'RENTAL_RETURN_RECEIVED',
        'RentalTerminationRequest',
        row.id,
        {
          allocationId: allocation.id,
          inspectionId: allocation.inspections[0].id,
          receivedAt: allocation.deallocatedAt.toISOString(),
        },
      );
      return row;
    });
  }

  async cancel(clientId: string, actor: AuthUser, requestId: string) {
    const rider = await this.riderForUser(clientId, actor.id);
    return this.serializable(async (tx) => {
      const request = await tx.rentalTerminationRequest.findFirst({
        where: { id: requestId, clientId, riderId: rider.id },
      });
      if (request && request.requestSource !== 'RIDER')
        fail('STAFF_RETURN_NOT_CANCELLABLE', 'This return was initiated by staff and cannot be cancelled by the rider. Contact your fleet manager.');
      const changed = await tx.rentalTerminationRequest.updateMany({
        where: {
          requestSource: 'RIDER',
          id: requestId,
          clientId,
          riderId: rider.id,
          status: 'REQUESTED',
          actualTerminationDate: null,
          vehicleSubmission: { is: null },
        },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: actor.id },
      });
      if (!changed.count) fail('RETURN_NOT_CANCELLABLE');
      await this.audit(tx, clientId, actor.id, 'RENTAL_TERMINATION_CANCELLED', 'RentalTerminationRequest', requestId);
      return tx.rentalTerminationRequest.findUniqueOrThrow({ where: { id: requestId } });
    });
  }

  private decodeCursor(cursor?: string) {
    if (!cursor) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    } catch {
      throw new BadRequestException('Invalid cursor.');
    }
    if (
      !parsed || typeof parsed !== 'object' ||
      typeof (parsed as { id?: unknown }).id !== 'string' ||
      typeof (parsed as { updatedAt?: unknown }).updatedAt !== 'string'
    ) throw new BadRequestException('Invalid cursor.');
    const updatedAt = new Date((parsed as { updatedAt: string }).updatedAt);
    if (Number.isNaN(updatedAt.getTime())) throw new BadRequestException('Invalid cursor.');
    return { id: (parsed as { id: string }).id, updatedAt };
  }

  async list(clientId: string, user: AuthUser, query: { cursor?: string; limit?: number; status?: string; hubId?: string; riderId?: string }) {
    const cursor = this.decodeCursor(query.cursor);
    const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
    const where: Prisma.RentalTerminationRequestWhereInput = {
      clientId,
      ...(query.riderId ? { riderId: query.riderId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.hubId ? { OR: [{ plannedHubId: query.hubId }, { receivedHubId: query.hubId }] } : {}),
    };
    if (this.fleetScoped(user)) {
      const hubs = await this.hubIds(clientId, user.id);
      where.AND = [
        ...(where.AND as Prisma.RentalTerminationRequestWhereInput[] | undefined ?? []),
        { OR: [{ plannedHubId: { in: hubs } }, { receivedHubId: { in: hubs } }] },
      ];
    }
    if (cursor) {
      where.AND = [
        ...(where.AND as Prisma.RentalTerminationRequestWhereInput[] | undefined ?? []),
        { OR: [{ updatedAt: { lt: cursor.updatedAt } }, { updatedAt: cursor.updatedAt, id: { lt: cursor.id } }] },
      ];
    }
    const rows = await this.db.rentalTerminationRequest.findMany({
      where,
      include: { returnPenaltyCase: { include: { items: true } }, vehicleSubmission: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last
        ? Buffer.from(JSON.stringify({ id: last.id, updatedAt: last.updatedAt.toISOString() })).toString('base64url')
        : null,
    };
  }

  async get(clientId: string, user: AuthUser, requestId: string) {
    await this.assertStaffReturnAccess(clientId, user, requestId);
    const row = await this.db.rentalTerminationRequest.findFirst({
      where: { id: requestId, clientId },
      include: {
        returnPenaltyCase: { include: { items: true } },
        vehicleSubmission: { include: { reports: { orderBy: { createdAt: 'asc' } } } },
        allocation: { include: { fleet: true, inspections: true } },
      },
    });
    if (!row) throw new NotFoundException('Return not found.');
    return row;
  }

  async riderList(clientId: string, actor: AuthUser, query: { cursor?: string; limit?: number; status?: string }) {
    const rider = await this.riderForUser(clientId, actor.id);
    return this.list(clientId, { ...actor }, { ...query, riderId: rider.id });
  }

  async riderGet(clientId: string, actor: AuthUser, requestId: string) {
    const rider = await this.riderForUser(clientId, actor.id);
    const row = await this.db.rentalTerminationRequest.findFirst({
      where: { id: requestId, clientId, riderId: rider.id },
      include: { returnPenaltyCase: { include: { items: true } }, vehicleSubmission: true },
    });
    if (!row) throw new NotFoundException('Return not found.');
    return row;
  }

  async receive(clientId: string, user: AuthUser, requestId: string, input: ReceiveRideReturnDto) {
    const recordedAt = new Date();
    const receivedAt = input.receivedAt === undefined
      ? recordedAt
      : parseDate(input.receivedAt, 'Invalid receivedAt.');
    if (receivedAt > recordedAt) throw new BadRequestException('A return cannot be received in the future.');
    if (receivedAt < recordedAt && !input.backdateReason?.trim())
      throw new BadRequestException('A reason is required for a backdated receipt.');
    const hub = await this.db.hub.findFirst({ where: { id: input.receivedHubId, clientId, deletedAt: null }, select: { id: true } });
    if (!hub) throw new NotFoundException('Receiving Hub not found.');
    await this.assertHubAccess(clientId, user, input.receivedHubId);
    return this.serializable(async (tx) => {
      const request = await tx.rentalTerminationRequest.findFirst({
        where: { id: requestId, clientId },
        include: { agreement: true },
      });
      if (!request) throw new NotFoundException('Return not found.');
      if (request.status === 'RETURNED') {
        if (
          request.receivedHubId === input.receivedHubId &&
          (input.receivedAt === undefined || request.actualTerminationDate?.getTime() === receivedAt.getTime())
        ) return request;
        fail('RETURN_ALREADY_RECEIVED');
      }
      if (request.submissionRequired) throw new ConflictException('Complete vehicle photos, mechanic report and rider/team lead OTPs or recorded bypasses through the vehicle submission workflow first.');
      if (request.status !== 'REQUESTED') fail('RETURN_NOT_RECEIVABLE');
      if (request.agreement.startDate && receivedAt < request.agreement.startDate)
        fail('RETURN_BEFORE_AGREEMENT');
      let allocationId = request.allocationId;
      if (!allocationId) {
        const legacy = await tx.allocation.findFirst({
          where: {
            clientId,
            riderId: request.riderId,
            fleetId: request.agreement.currentVehicleId ?? request.agreement.vehicleId,
            status: {
              in: [AllocationStatus.ACTIVE, AllocationStatus.DEALLOCATION_INITIATED],
            },
          },
        });
        if (!legacy) throw new ConflictException('ACTIVE_ALLOCATION_REQUIRED');
        allocationId = legacy.id;
      }
      const started = await this.allocations.initiateDeallocationInTransaction(tx, clientId, allocationId);
      await tx.allocation.update({ where: { id: allocationId }, data: { deallocatedAt: receivedAt } });
      await tx.fleet.update({
        where: {
          id: (
            await tx.allocation.findUniqueOrThrow({
              where: { id: allocationId },
              select: { fleetId: true },
            })
          ).fleetId,
        },
        data: {
          status: FleetStatus.INSPECTION_PENDING,
          currentHubId: input.receivedHubId,
          allocationEnabled: false,
        },
      });
      const row = await tx.rentalTerminationRequest.update({
        where: { id: request.id },
        data: {
          status: 'RETURNED',
          allocationId,
          receivedHubId: input.receivedHubId,
          actualTerminationDate: receivedAt,
          receiptRecordedAt: recordedAt,
          receiptRecordedById: user.id,
          receiptBackdateReason: receivedAt < recordedAt ? input.backdateReason!.trim() : null,
        },
      });
      await tx.riderRentalAgreement.update({
        where: { id: request.agreementId },
        data: {
          status: 'TERMINATED',
          commercialClosureState: 'FINAL_BILLING_PENDING',
          terminationEffectiveAt: receivedAt,
          terminatedAt: recordedAt,
          updatedById: user.id,
        },
      });
      await tx.riderRentalAgreementStatusHistory.create({
        data: {
          clientId,
          agreementId: request.agreementId,
          previousStatus: request.agreement.status,
          newStatus: 'TERMINATED',
          reason: 'VEHICLE_RETURN',
          changedById: user.id,
        },
      });
      await this.audit(tx, clientId, user.id, 'RENTAL_RETURN_RECEIVED', 'RentalTerminationRequest', row.id, {
        receivedAt: receivedAt.toISOString(),
        recordedAt: recordedAt.toISOString(),
        receivedHubId: input.receivedHubId,
        allocationId,
        inspectionId: started.inspectionId,
      });
      return { ...row, inspectionId: started.inspectionId };
    });
  }

  async prices(clientId: string, activeOnly = true) {
    return this.db.returnPenaltyPrice.findMany({ where: { clientId, ...(activeOnly ? { isActive: true } : {}) }, orderBy: [{ category: 'asc' }, { code: 'asc' }] });
  }

  async createPrice(clientId: string, actorId: string, input: ReturnPenaltyPriceDto) {
    const value = new Prisma.Decimal(input.amount);
    if (!value.isFinite() || value.lte(0) || value.decimalPlaces() > 2) throw new BadRequestException('Invalid positive amount.');
    return this.db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Client" WHERE id=${clientId} FOR UPDATE`;if(await tx.returnPenaltyPrice.findUnique({where:{clientId_code:{clientId,code:input.code}}}))throw new ConflictException('Penalty code is already used by this client.');const row=await tx.returnPenaltyPrice.create({data:{clientId,code:input.code,category:input.category,description:input.description.trim(),amount:value,currency:input.currency,createdById:actorId}});await recordSpareRevision(tx,row,actorId,'Operational penalty created.');return row;});
  }
  async updatePrice(clientId: string, actorId: string, priceId: string, input: UpdateReturnPenaltyPriceDto) {
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "Client" WHERE id=${clientId} FOR UPDATE`;
      const existing=await tx.returnPenaltyPrice.findFirst({where:{id:priceId,clientId}});if(!existing)throw new NotFoundException('Penalty price not found.');
      if(existing.isSpare)throw new BadRequestException('Manage spare penalties through Client Spares & Penalties.');
      const amount=input.amount===undefined?undefined:new Prisma.Decimal(input.amount);if(amount&&(!amount.isFinite()||amount.lte(0)||amount.decimalPlaces()>2))throw new BadRequestException('Invalid positive amount.');
      const row=await tx.returnPenaltyPrice.update({where:{id:priceId},data:{...(input.description===undefined?{}:{description:input.description.trim()}),...(amount?{amount}:{}),...(input.currency?{currency:input.currency}:{}),...(input.isActive===undefined?{}:{isActive:input.isActive}),configurationVersion:{increment:1},updatedById:actorId}});await recordSpareRevision(tx,row,actorId,'Operational penalty updated.');return row;
    });
  }

  private async caseFor(clientId: string, requestId: string) {
    const row = await this.db.returnPenaltyCase.findFirst({
      where: { clientId, terminationRequestId: requestId },
      include: { items: true, terminationRequest: true, inspection: true },
    });
    if (!row) throw new NotFoundException('Penalty case not found.');
    return row;
  }

  private async validateDraftPenaltyItems(tx: Tx, clientId: string, inspectionId: string, items: readonly PenaltyItemInput[]) {
    if (!items.length) return [] as const;
    const prices = await tx.returnPenaltyPrice.findMany({ where: { id: { in: items.map((item) => item.priceId) }, clientId } });
    const byId = new Map(prices.map((price) => [price.id, price]));
    const photos = await tx.photo.findMany({ where: { clientId, workFlowType: 'FLEET_SUBMISSION', subjectType: 'INSPECTION', entityId: inspectionId, status: 'COMPLETE' }, select: { id: true, photoType: true } });
    const photoById = new Map(photos.map((photo) => [photo.id, photo]));
    return items.map((item, position) => {
      const price = byId.get(item.priceId);
      if (!price) throw new BadRequestException('Penalty price is not available for this client.');
      if (price.isSpare) throw new BadRequestException('Use the vehicle submission report flow for spare penalties.');
      if (!PENALTY_CATEGORIES.has(price.category)) throw new BadRequestException('Invalid penalty category.');
      const details = item.details.trim();
      if (!details) throw new BadRequestException('Penalty details are required.');
      const evidence = [...new Set(item.evidencePhotoIds)];
      const validPhotos = evidence.map((id) => photoById.get(id));
      if (validPhotos.some((photo) => !photo)) throw new BadRequestException('Penalty evidence must belong to the return inspection.');
      if (!evidence.length) throw new BadRequestException('Penalty evidence is required.');
      if (price.category === 'MISSING_ITEM' && !validPhotos.some((photo) => photo?.photoType === 'RETURN_CHECKLIST'))
        throw new BadRequestException('Missing-item penalties require a return checklist photo.');
      return { position, price, details, evidencePhotoIds: evidence };
    });
  }

  private async snapshotSubmittedItems(
    tx: Tx,
    clientId: string,
    caseId: string,
    inspectionId: string,
    revision: number,
  ) {
    const draftItems = await tx.returnPenaltyItem.findMany({
      where: { caseId, revision },
      orderBy: { position: 'asc' },
    });
    if (!draftItems.length)
      return {
        items: [],
        total: new Prisma.Decimal(0),
        currency: null as string | null,
        digest: null as string | null,
      };

    const prices = await tx.returnPenaltyPrice.findMany({
      where: {
        clientId,
        isActive: true,
        id: { in: draftItems.map((item) => item.priceListItemId) },
      },
    });
    const byId = new Map(prices.map((price) => [price.id, price]));
    const photos = await tx.photo.findMany({
      where: {
        clientId,
        workFlowType: 'FLEET_SUBMISSION',
        subjectType: 'INSPECTION',
        entityId: inspectionId,
        status: 'COMPLETE',
      },
      select: { id: true, photoType: true },
    });
    const photoById = new Map(photos.map((photo) => [photo.id, photo]));
    const snapshots = draftItems.map((item) => {
      const price = byId.get(item.priceListItemId);
      if (!price) throw new BadRequestException('Penalty price must be active when submitted.');
      if (price.isSpare) throw new BadRequestException('Use the vehicle submission report flow for spare penalties.');
      if (!PENALTY_CATEGORIES.has(price.category)) throw new BadRequestException('Invalid penalty category.');
      const details = item.details.trim();
      if (!details) throw new BadRequestException('Penalty details are required.');
      const evidencePhotoIds = [...new Set(item.evidencePhotoIds)];
      const validPhotos = evidencePhotoIds.map((id) => photoById.get(id));
      if (!evidencePhotoIds.length || validPhotos.some((photo) => !photo))
        throw new BadRequestException('Penalty evidence must belong to the return inspection.');
      if (price.category === 'MISSING_ITEM' && !validPhotos.some((photo) => photo?.photoType === 'RETURN_CHECKLIST'))
        throw new BadRequestException('Missing-item penalties require a return checklist photo.');
      return { row: item, price, details, evidencePhotoIds };
    });
    const currency = snapshots[0]!.price.currency;
    if (snapshots.some((item) => item.price.currency !== currency))
      throw new BadRequestException('Penalty prices must use one currency.');
    const total = snapshots.reduce((sum, item) => sum.plus(item.price.amount), new Prisma.Decimal(0));
    for (const item of snapshots) {
      await tx.returnPenaltyItem.update({
        where: { id: item.row.id },
        data: {
          priceCode: item.price.code,
          category: item.price.category,
          description: item.price.description,
          amount: item.price.amount,
          currency: item.price.currency,
          details: item.details,
          evidencePhotoIds: item.evidencePhotoIds,
        },
      });
    }
    const digest = digestFor(
      caseId,
      revision,
      snapshots.map((item) => ({
        position: item.row.position,
        priceCode: item.price.code,
        category: item.price.category,
        description: item.price.description,
        amount: money(item.price.amount),
        currency: item.price.currency,
        details: item.details,
        evidencePhotoIds: item.evidencePhotoIds,
      })),
      money(total),
    );
    return { items: snapshots, total, currency, digest };
  }

  async replacePenalties(clientId: string, user: AuthUser, requestId: string, input: ReplaceReturnPenaltiesDto) {
    await this.assertStaffReturnAccess(clientId, user, requestId);
    return this.serializable(async (tx) => {
      const request = await tx.rentalTerminationRequest.findFirst({ where: { id: requestId, clientId } });
      if (request?.submissionRequired) throw new ConflictException('Use the proof-backed vehicle submission reports for initial and additional penalties.');
      if (!request?.actualTerminationDate || !request.allocationId) throw new ConflictException('VEHICLE_RETURN_REQUIRED');
      const inspection = await tx.inspection.findFirst({ where: { clientId, allocationId: request.allocationId, type: 'POST_DEALLOCATION', status: 'COMPLETED' } });
      if (!inspection) throw new ConflictException('VEHICLE_RETURN_INSPECTION_REQUIRED');
      let penaltyCase = await tx.returnPenaltyCase.findUnique({ where: { terminationRequestId: request.id } });
      if (penaltyCase && !['DRAFT', 'RIDER_DISPUTED'].includes(penaltyCase.status)) fail('PENALTY_CASE_IMMUTABLE');
      if (!penaltyCase) {
        penaltyCase = await tx.returnPenaltyCase.create({ data: { clientId, riderId: request.riderId, terminationRequestId: request.id, inspectionId: inspection.id, currency: 'INR' } });
      }
      const drafts = await this.validateDraftPenaltyItems(tx, clientId, inspection.id, input.items);
      const revision = penaltyCase.currentRevision + 1;
      await tx.returnPenaltyItem.createMany({ data: drafts.map((item) => ({ clientId, caseId: penaltyCase!.id, revision, position: item.position, priceListItemId: item.price.id, details: item.details, evidencePhotoIds: item.evidencePhotoIds, createdById: user.id })) });
      const updated = await tx.returnPenaltyCase.update({ where: { id: penaltyCase.id }, data: { currentRevision: revision, digest: null, totalAmount: 0, status: 'DRAFT', submittedAt: null, submittedById: null, riderDisputedRevision: null, riderDisputedAt: null, riderDisputeReason: null, managerApprovedRevision: null, managerApprovedAt: null, managerApprovedById: null, postedRevision: null, postedChargeId: null, postedAt: null } });
      await this.audit(tx, clientId, user.id, 'RETURN_PENALTIES_REPLACED', 'ReturnPenaltyCase', updated.id, { revision, itemCount: drafts.length });
      return { ...updated, items: await tx.returnPenaltyItem.findMany({ where: { caseId: updated.id, revision }, orderBy: { position: 'asc' } }) };
    });
  }

  async submitPenalties(clientId: string, user: AuthUser, requestId: string) {
    await this.assertStaffReturnAccess(clientId, user, requestId);
    return this.serializable(async (tx) => {
      const request = await tx.rentalTerminationRequest.findFirst({ where: { id: requestId, clientId } });
      if (request?.submissionRequired) throw new ConflictException('Use the proof-backed vehicle submission reports for initial and additional penalties.');
      if (!request?.actualTerminationDate || !request.allocationId) throw new ConflictException('VEHICLE_RETURN_REQUIRED');
      const inspection = await tx.inspection.findFirst({ where: { allocationId: request.allocationId, type: 'POST_DEALLOCATION', status: 'COMPLETED' } });
      if (!inspection) throw new ConflictException('VEHICLE_RETURN_INSPECTION_REQUIRED');
      let penaltyCase = await tx.returnPenaltyCase.findUnique({ where: { terminationRequestId: request.id } });
      if (!penaltyCase) penaltyCase = await tx.returnPenaltyCase.create({ data: { clientId, riderId: request.riderId, terminationRequestId: request.id, inspectionId: inspection.id, currency: 'INR' } });
      if (penaltyCase.status === 'POSTED') return penaltyCase;
      if (!['DRAFT', 'RIDER_DISPUTED'].includes(penaltyCase.status)) fail('PENALTY_CASE_NOT_SUBMITTABLE');
      const revision = penaltyCase.currentRevision || 1;
      const draftItems = await tx.returnPenaltyItem.findMany({ where: { caseId: penaltyCase.id, revision }, select: { amount: true } });
      if (penaltyCase.status === 'RIDER_DISPUTED' && draftItems.some((item) => item.amount !== null))
        fail('PENALTY_REVISION_REQUIRES_REPLACEMENT');
      const snapshot = await this.snapshotSubmittedItems(tx, clientId, penaltyCase.id, inspection.id, revision);
      const submittedAt = new Date();
      if (!snapshot.items.length) {
        const updated = await tx.returnPenaltyCase.update({ where: { id: penaltyCase.id }, data: { currentRevision: revision, status: 'POSTED', digest: null, totalAmount: 0, submittedAt, submittedById: user.id, riderDisputedRevision: null, riderDisputedAt: null, riderDisputeReason: null, managerApprovedRevision: null, managerApprovedAt: null, managerApprovedById: null, postedRevision: revision, postedChargeId: null, postedAt: submittedAt } });
        await this.audit(tx, clientId, user.id, 'RETURN_PENALTIES_POSTED', 'ReturnPenaltyCase', updated.id, { revision, totalAmount: '0.00', chargeId: null });
        return updated;
      }
      const updated = await tx.returnPenaltyCase.update({ where: { id: penaltyCase.id }, data: { currentRevision: revision, status: 'MANAGER_APPROVAL_PENDING', digest: snapshot.digest, totalAmount: snapshot.total, currency: snapshot.currency!, submittedAt, submittedById: user.id, riderDisputedRevision: null, riderDisputedAt: null, riderDisputeReason: null, managerApprovedRevision: null, managerApprovedAt: null, managerApprovedById: null, postedRevision: null, postedChargeId: null, postedAt: null } });
      await this.audit(tx, clientId, user.id, 'RETURN_PENALTIES_SUBMITTED', 'ReturnPenaltyCase', updated.id, { revision, totalAmount: money(snapshot.total), digest: snapshot.digest! });
      return updated;
    });
  }

  async disputePenalties(clientId: string, actor: AuthUser, requestId: string, input: DisputeReturnPenaltyDto) {
    const rider = await this.riderForUser(clientId, actor.id);
    if (!input.reason.trim()) throw new BadRequestException('Dispute reason is required.');
    return this.serializable(async (tx) => {
      const row = await tx.returnPenaltyCase.findFirst({ where: { clientId, riderId: rider.id, terminationRequest: { id: requestId } } });
      if (!row) throw new NotFoundException('Penalty case not found.');
      if (row.status !== 'MANAGER_APPROVAL_PENDING') fail('PENALTY_NOT_DISPUTABLE');
      const changed = await tx.returnPenaltyCase.updateMany({ where: { id: row.id, clientId, riderId: rider.id, currentRevision: row.currentRevision, status: row.status }, data: { status: 'RIDER_DISPUTED', riderDisputedRevision: row.currentRevision, riderDisputedAt: new Date(), riderDisputeReason: input.reason.trim() } });
      if (!changed.count) fail('PENALTY_STATE_CHANGED');
      const updated = await tx.returnPenaltyCase.findUniqueOrThrow({ where: { id: row.id } });
      await this.audit(tx, clientId, actor.id, 'RETURN_PENALTIES_DISPUTED', 'ReturnPenaltyCase', updated.id, { reason: input.reason.trim(), revision: updated.currentRevision });
      return updated;
    });
  }

  async approvePenalties(clientId: string, actor: AuthUser, requestId: string) {
    if (!actor.roles.includes(UserRole.FLEET_MANAGER))
      throw new ForbiddenException('Only a Fleet Manager may approve penalties.');
    await this.assertStaffReturnAccess(clientId, actor, requestId);
    return this.serializable(async (tx) => {
      const row = await tx.returnPenaltyCase.findFirst({ where: { clientId, terminationRequest: { id: requestId } } });
      if (!row) throw new NotFoundException('Penalty case not found.');
      if (row.status === 'POSTED') return row;
      if (!['MANAGER_APPROVAL_PENDING', 'RIDER_DISPUTED'].includes(row.status)) fail('PENALTY_MANAGER_APPROVAL_REQUIRED');
      if (row.managerApprovedRevision !== row.currentRevision) {
        const updated = await tx.returnPenaltyCase.updateMany({ where: { id: row.id, clientId, currentRevision: row.currentRevision, status: row.status }, data: { managerApprovedRevision: row.currentRevision, managerApprovedAt: new Date(), managerApprovedById: actor.id } });
        if (!updated.count) fail('PENALTY_STATE_CHANGED');
        await this.audit(tx, clientId, actor.id, 'RETURN_PENALTIES_MANAGER_APPROVED', 'ReturnPenaltyCase', row.id, { revision: row.currentRevision });
      }
      return this.postIfFullyApproved(tx, clientId, actor.id, row.id);
    });
  }

  private async postIfFullyApproved(tx: Tx, clientId: string, actorId: string | null, caseId: string) {
    const row = await tx.returnPenaltyCase.findFirst({ where: { id: caseId, clientId } });
    if (!row) throw new NotFoundException('Penalty case not found.');
    if (row.status === 'POSTED') return row;
    if (row.managerApprovedRevision !== row.currentRevision)
      return row;
    if (!row.digest || row.currentRevision <= 0) fail('PENALTY_REVISION_NOT_SUBMITTED');
    const items = await tx.returnPenaltyItem.findMany({ where: { caseId: row.id, revision: row.currentRevision }, orderBy: { position: 'asc' } });
    if (!items.length) fail('PENALTY_REVISION_CHANGED');
    if (items.some((item) => !item.priceCode || !item.category || !item.description || !item.amount || !item.currency))
      fail('PENALTY_REVISION_CHANGED');
    const total = items.reduce((sum, item) => sum.plus(item.amount!), new Prisma.Decimal(0));
    const currency = items[0]!.currency!;
    if (items.some((item) => item.currency !== currency) || !row.totalAmount.eq(total) || row.currency !== currency)
      fail('PENALTY_REVISION_CHANGED');
    const digest = digestFor(row.id, row.currentRevision, items.map((item) => ({ position: item.position, priceCode: item.priceCode!, category: item.category!, description: item.description!, amount: money(item.amount!), currency: item.currency!, details: item.details, evidencePhotoIds: item.evidencePhotoIds })), money(total));
    if (digest !== row.digest) fail('PENALTY_REVISION_CHANGED');
    const charge = await this.billing.issueChargeInTransaction(tx, clientId, row.riderId, actorId, `return-penalty:${row.id}:r${row.currentRevision}`, {
      chargeType: 'RETURN_PENALTY',
      description: `Return penalties (${row.currentRevision})`,
      quantity: '1',
      unitAmount: money(row.totalAmount),
      currency: row.currency,
      referenceType: 'RETURN_PENALTY',
      referenceId: row.id,
    });
    const changed = await tx.returnPenaltyCase.updateMany({ where: { id: row.id, clientId, currentRevision: row.currentRevision, postedChargeId: null, status: { not: 'POSTED' } }, data: { status: 'POSTED', postedRevision: row.currentRevision, postedChargeId: charge.id, postedAt: new Date() } });
    if (!changed.count) return tx.returnPenaltyCase.findUniqueOrThrow({ where: { id: row.id } });
    await this.audit(tx, clientId, actorId ?? row.managerApprovedById ?? row.riderId, 'RETURN_PENALTIES_POSTED', 'ReturnPenaltyCase', row.id, { revision: row.currentRevision, chargeId: charge.id, amount: money(row.totalAmount) });
    return tx.returnPenaltyCase.findUniqueOrThrow({ where: { id: row.id } });
  }
}
