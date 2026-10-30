import { plannedDate, selectSubmissionHub } from '../vehicle-submissions/submission-hub.js';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  UserRole,
} from '@prisma/client';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateRideReturnDto,
} from './dto/ride-return.dto.js';

type Tx = Prisma.TransactionClient;
type RequestSource = 'RIDER' | 'STAFF';
type RequestInput = CreateRideReturnDto & { agreementId?: string };

const RETURNABLE_AGREEMENTS = new Set(['ACTIVE', 'SUSPENDED', 'TERMINATION_PENDING']);
const fail = (code: string, message = code): never => {
  throw new ConflictException({ code, message });
};

@Injectable()
export class RideReturnsService {
  constructor(private readonly db: PrismaService) {}

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
}
