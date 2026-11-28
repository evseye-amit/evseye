import { AllocationNotificationService } from './allocation-notification.service.js';
import { DeploymentCommercialService } from './deployment-commercial.service.js';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AllocationStatus,
  FleetStatus,
  InspectionStatus,
  InspectionType,
  Prisma,
  RiderStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ListAllocationsDto } from './dto/list-allocations.dto.js';
import { RiderDocumentReviewService } from '../riders/rider-document-review.service.js';

@Injectable()
export class AllocationsService {
  constructor(private readonly prisma: PrismaService, private readonly commercial: DeploymentCommercialService, private readonly notifications: AllocationNotificationService, private readonly riderDocuments?: RiderDocumentReviewService) {}
  async list(clientId: string, query: ListAllocationsDto, hubIds?: string[]) {
    const where = {
      clientId,
      ...(hubIds ? { fleet: { currentHubId: { in: hubIds } } } : {}),
      ...(query.status ? { status: query.status as AllocationStatus } : {}),
      ...(query.riderId ? { riderId: query.riderId } : {}),
      ...(query.fleetId ? { fleetId: query.fleetId } : {}),
      ...(query.search
        ? {
            OR: [
              {
                fleet: {
                  vehicleNumber: {
                    contains: query.search,
                    mode: 'insensitive' as const,
                  },
                },
              },
              {
                rider: {
                  name: {
                    contains: query.search,
                    mode: 'insensitive' as const,
                  },
                },
              },
              { rider: { mobile: { contains: query.search } } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.allocation.findMany({
        where,
        include: {
          rider: true,
          fleet: { include: { currentHub: true } },
          inspections: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.allocation.count({ where }),
    ]);
    return {
      items,
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async get(clientId: string, allocationId: string, hubIds?: string[]) {
    const allocation = await this.prisma.allocation.findFirst({
      where: { id: allocationId, clientId, ...(hubIds ? { fleet: { currentHubId: { in: hubIds } } } : {}) },
      include: {
        rider: true,
        fleet: { include: {
          currentHub: true,
          batteryHistory: {
            where: { removedAt: null, battery: { clientId } },
            orderBy: { installedAt: 'asc' },
            select: { battery: { select: { batteryType: true, serialNumber: true } } },
          },
        } },
        inspections: true,
      },
    });
    if (!allocation) throw new NotFoundException('Allocation not found.');
    return allocation;
  }

  async fleetManagerHubIds(clientId: string, userId: string) {
    return (await this.prisma.userHub.findMany({ where: { clientId, userId, hub: { clientId, status: 'ACTIVE', deletedAt: null } }, select: { hubId: true } })).map((entry) => entry.hubId);
  }
  async assertFleetManagerFleet(clientId: string, userId: string, fleetId: string) {
    const hubIds = await this.fleetManagerHubIds(clientId, userId);
    const fleet = await this.prisma.fleet.findFirst({ where: { id: fleetId, clientId, currentHubId: { in: hubIds }, deletedAt: null }, select: { id: true } });
    if (!fleet) throw new NotFoundException('Fleet not found in an assigned Hub.');
    return hubIds;
  }
  async assertFleetManagerAllocation(clientId: string, userId: string, allocationId: string) {
    const hubIds = await this.fleetManagerHubIds(clientId, userId);
    const allocation = await this.prisma.allocation.findFirst({ where: { id: allocationId, clientId, fleet: { currentHubId: { in: hubIds } } }, select: { id: true } });
    if (!allocation) throw new NotFoundException('Allocation not found in an assigned Hub.');
    return hubIds;
  }
  async initiate(
    clientId: string,
    fleetId: string,
    riderId: string,
    actorId: string,
    idempotencyKey?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Fleet" WHERE "id" = ${fleetId} AND "clientId" = ${clientId} FOR UPDATE`;
      const exchangeId = idempotencyKey?.startsWith('exchange:') ? idempotencyKey.slice('exchange:'.length) : null;
      const hold = await tx.vehicleExchangeRequest.findFirst({
        where: { clientId, replacementVehicleId: fleetId, OR: [{ status: { in: ['REPLACEMENT_SELECTED', 'OFFER_PRESENTED'] }, reservationExpiresAt: { gt: new Date() } }, { status: { in: ['ACCEPTED', 'RETURN_PENDING', 'DEPOSIT_PENDING', 'HANDOVER_PENDING'] } }] },
      });
      if (hold && (hold.id !== exchangeId || hold.riderId !== riderId || hold.status !== 'HANDOVER_PENDING'))
        throw new ConflictException('Fleet is reserved for a vehicle exchange.');
      const rider = await tx.rider.findFirst({
        where: { id: riderId, clientId, deletedAt: null },
      });
      if (!rider) throw new NotFoundException('Rider not found.');
      if (!exchangeId) {
        const restriction = await tx.commercialRestriction.findFirst({ where: { clientId, riderId, code: 'BLOCK_NEW_VEHICLE_ALLOCATION', status: 'ACTIVE' } });
        if (restriction) throw new ConflictException({ code: 'COLLECTION_RESTRICTION_ACTIVE', collectionCaseId: restriction.caseId });
      }
      if (rider.status !== RiderStatus.ACTIVE) {
        throw new ConflictException('Rider must be active before allocation.');
      }
      const documentBlockers = this.riderDocuments ? await this.riderDocuments.allocationBlockers(clientId, riderId) : [];
      if (documentBlockers.length) {
        throw new ConflictException({ code: 'RIDER_VERIFICATION_PENDING', message: 'Rider verification must be completed before Fleet allocation.', issues: documentBlockers });
      }
      const reserved = await tx.fleet.updateMany({
        where: {
          id: fleetId,
          clientId,
          status: FleetStatus.AVAILABLE,
          deletedAt: null,
          allocations: { none: { status: { notIn: [AllocationStatus.COMPLETED, AllocationStatus.CANCELLED] } } },
        },
        data: { status: FleetStatus.RESERVED },
      });
      if (reserved.count !== 1)
        throw new ConflictException('Fleet is not available for allocation.');
      await this.assertRequiredFleetPhotos(tx, clientId, fleetId);
      const allocation = await tx.allocation.create({
        data: {
          clientId,
          fleetId,
          riderId,
          initiatedById: actorId,
          idempotencyKey,
          status: 'INSPECTION_PENDING',
          ...(hold ? { rentalAgreementId: hold.agreementId } : {}),
        },
      });
      await tx.inspection.create({
        data: {
          clientId,
          allocationId: allocation.id,
          type: InspectionType.PRE_ALLOCATION,
          status: InspectionStatus.DRAFT,
        },
      });
      await tx.mobileDeploymentWorkflow.create({
        data: { clientId, allocationId: allocation.id, status: 'RIDER_WAITING' },
      });
      await this.notifications.enqueue(tx, clientId, allocation.id, 'REQUESTED');
      return allocation;
    });
  }

  private async assertRequiredFleetPhotos(
    tx: Prisma.TransactionClient,
    clientId: string,
    fleetId: string,
  ) {
    const client = await tx.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { fleetOperatingMode: true },
    });
    const fleet = await tx.fleet.findFirst({
      where: { id: fleetId, clientId },
      select: {
        readinessWorkflow: true,
        readinessApprovedPreparationId: true,
        allocationBlockedByAdmin: true,
        allocationEnabled: true,
      },
    });
    const workflow = fleet?.readinessWorkflow === 'ONBOARDING_EVIDENCE'
      ? 'SIMPLE'
      : fleet?.readinessWorkflow ?? client.fleetOperatingMode;
    if (fleet?.allocationBlockedByAdmin || fleet?.allocationEnabled === false)
      throw new ConflictException(
        'Allocation is administratively disabled for this scooter.',
      );
    if (['PREPARATION_QC', 'STAGED_PREPARATION_QC'].includes(workflow)) {
      if (!fleet?.readinessApprovedPreparationId)
        throw new ConflictException(
          'Preparation and QC approval are required before allocation.',
        );
    }
    // Keep onboarding media readable as history, but never use it as an
    // allocation gate. Preparation media remains enforced by readiness.
  }
  async cancel(clientId: string, allocationId: string, actorId: string, reason: string) {
    const cancellationReason = reason.trim();
    if (cancellationReason.length < 3 || cancellationReason.length > 1000)
      throw new BadRequestException('Cancellation reason must contain 3–1000 characters.');
    return this.prisma.$transaction(async (tx) => {
      // Share the activation lock so handover and cancellation cannot both succeed.
      await tx.$queryRaw`SELECT id FROM "Allocation" WHERE id = ${allocationId} AND "clientId" = ${clientId} FOR UPDATE`;
      const allocation = await tx.allocation.findFirst({
        where: { id: allocationId, clientId },
        include: { mobileDeployment: { include: { payment: true } } },
      });
      if (!allocation) throw new NotFoundException('Allocation not found.');
      // Never release the fleet again on a retry: it may already be reallocated.
      if (allocation.status === AllocationStatus.CANCELLED)
        return { allocationId, status: AllocationStatus.CANCELLED, alreadyCancelled: true };
      if (allocation.allocatedAt || !(['INITIATED', 'INSPECTION_PENDING', 'OTP_PENDING'] as string[]).includes(allocation.status))
        throw new ConflictException('Only pending allocations before handover can be cancelled. Use deallocation for an active allocation.');
      const workflow = allocation.mobileDeployment;
      const payment = workflow?.payment;
      if (workflow?.status === 'DEPLOYED' || workflow?.pairedAt || workflow?.pairingBypassedAt)
        throw new ConflictException('Vehicle handover has been recorded. Use the return/deallocation workflow.');
      // Workflow stages are progress markers, not evidence of a money transfer.
      // A zero quote is automatically PAID with NO_PAYMENT_REQUIRED and may
      // advance through PDI/training without the rider paying anything.
      const noPaymentRequired = payment?.status === 'PAID'
        && payment.provider === 'NO_PAYMENT_REQUIRED' && payment.amount.eq(0);
      if (!payment && workflow && (workflow.paymentPaidAt || ['PAYMENT_PAID', 'PDI_PENDING_RIDER', 'TRAINING_PENDING', 'DEVICE_PAIRING_PENDING'].includes(workflow.status)))
        throw new ConflictException(`Deployment stage ${workflow.status} has no payment record. Reconcile the missing record before cancellation.`);
      if (payment && !noPaymentRequired && (payment.paidAt || !['PENDING', 'REJECTED', 'FAILED', 'CANCELLED'].includes(payment.status)))
        throw new ConflictException(`Payment status is ${payment.status}${payment.amount ? ` (${payment.currency} ${payment.amount.toString()})` : ''}. Review the received payment or submitted reference before cancellation.`);
      if (payment && await tx.deploymentPaymentCapture.count({ where: { attempt: { clientId, deploymentPaymentId: payment.id } } }))
        throw new ConflictException('A gateway payment has been received. Resolve its refund or reconciliation before cancellation.');
      await tx.$queryRaw`SELECT id FROM "Fleet" WHERE id = ${allocation.fleetId} AND "clientId" = ${clientId} FOR UPDATE`;
      const exchange = await tx.vehicleExchangeRequest.findFirst({
        where: { clientId, OR: [
          { newAllocationId: allocationId },
          { replacementVehicleId: allocation.fleetId, status: { notIn: ['COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED'] } },
        ] },
        select: { id: true },
      });
      if (exchange) throw new ConflictException('This reservation belongs to a vehicle exchange. Resolve the exchange before cancellation.');
      await this.cancelUnpaidCommercials(tx, clientId, allocation, actorId, cancellationReason);
      if (payment) await tx.deploymentPayment.update({ where: { id: payment.id }, data: { status: 'CANCELLED' } });
      const released = await tx.fleet.updateMany({
        where: { id: allocation.fleetId, clientId, status: FleetStatus.RESERVED, deletedAt: null,
          allocations: { none: { id: { not: allocationId }, status: { notIn: [AllocationStatus.COMPLETED, AllocationStatus.CANCELLED] } } } },
        data: { status: FleetStatus.AVAILABLE },
      });
      if (released.count !== 1) throw new ConflictException('The fleet reservation changed. Refresh and try again.');
      await tx.allocation.update({ where: { id: allocationId }, data: { status: AllocationStatus.CANCELLED } });
      // Keep reason, actor and timestamp in the existing durable audit history.
      await tx.auditLog.create({ data: {
        clientId, actorId, action: 'ALLOCATION_CANCELLED', entityType: 'ALLOCATION', entityId: allocationId,
        previousData: { status: allocation.status, fleetStatus: FleetStatus.RESERVED },
        newData: { status: AllocationStatus.CANCELLED, fleetStatus: FleetStatus.AVAILABLE,
          fleetId: allocation.fleetId, riderId: allocation.riderId, reason: cancellationReason,
          paymentId: payment?.id ?? null, rentalAgreementId: allocation.rentalAgreementId, commercialOfferId: allocation.commercialOfferId },
      } });
      return { allocationId, status: AllocationStatus.CANCELLED, alreadyCancelled: false };
    });
  }

  private async cancelUnpaidCommercials(
    tx: Prisma.TransactionClient, clientId: string,
    allocation: { commercialOfferId: string | null; rentalAgreementId: string | null; riderId: string; fleetId: string },
    actorId: string, reason: string,
  ) {
    const now = new Date();
    // Offer acceptance uses the same allocation -> offer lock order.
    if (allocation.commercialOfferId)
      await tx.$queryRaw`SELECT id FROM "RiderCommercialOffer" WHERE id = ${allocation.commercialOfferId} AND "clientId" = ${clientId} FOR UPDATE`;
    if (allocation.rentalAgreementId) {
      const agreementId = allocation.rentalAgreementId;
      await tx.$queryRaw`SELECT id FROM "RiderRentalAgreement" WHERE id = ${agreementId} AND "clientId" = ${clientId} FOR UPDATE`;
      const agreement = await tx.riderRentalAgreement.findFirst({ where: { id: agreementId, clientId, riderId: allocation.riderId, vehicleId: allocation.fleetId } });
      if (!agreement || !['PENDING_ACTIVATION', 'CANCELLED'].includes(agreement.status) || agreement.activatedAt)
        throw new ConflictException('The rental agreement is already active or has changed. Refresh and review it before cancellation.');
      await tx.$queryRaw`SELECT id FROM "RiderDeposit" WHERE "agreementId" = ${agreementId} AND "clientId" = ${clientId} ORDER BY id FOR UPDATE`;
      const funded = await tx.riderDeposit.count({ where: { clientId, agreementId, OR: [{ fundedAmount: { gt: 0 } }, { availableAmount: { gt: 0 } }] } });
      if (funded) throw new ConflictException('This agreement has a funded deposit. Resolve the deposit before cancellation.');
      // Separate deposit checkout requests require their own reconciliation workflow.
      const collections = await tx.paymentCollectionRequest.count({ where: { clientId, deposit: { agreementId }, status: { notIn: ['CANCELLED', 'FAILED', 'EXPIRED'] } } });
      if (collections) throw new ConflictException('A separate deposit collection is pending. Resolve it before cancelling this allocation.');
      await tx.riderDeposit.updateMany({ where: { clientId, agreementId, fundedAmount: 0, availableAmount: 0 }, data: { status: 'CLOSED', updatedById: actorId } });
      if (agreement.status !== 'CANCELLED') {
        await tx.riderRentalAgreement.update({ where: { id: agreementId }, data: { status: 'CANCELLED', updatedById: actorId } });
        await tx.riderRentalAgreementStatusHistory.create({ data: { clientId, agreementId, previousStatus: agreement.status, newStatus: 'CANCELLED', reason, changedById: actorId } });
      }
      await tx.riderAgreementCommercialVersion.updateMany({ where: { clientId, agreementId, status: 'PENDING' }, data: { status: 'CANCELLED', effectiveTo: now } });
    }
    if (allocation.commercialOfferId) {
      // Preserve accepted offer evidence; its agreement is cancelled above.
      await tx.riderCommercialOffer.updateMany({ where: { id: allocation.commercialOfferId, clientId, status: { in: ['CALCULATED', 'PRESENTED'] } },
        data: { status: 'CANCELLED', cancelledAt: now, cancelledById: actorId, cancellationReason: reason, updatedById: actorId } });
    }
  }

  async activate(clientId: string, allocationId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Allocation" WHERE id = ${allocationId} AND "clientId" = ${clientId} FOR UPDATE`;
      const allocation = await tx.allocation.findFirst({
        where: {
          id: allocationId,
          clientId,
          status: AllocationStatus.OTP_PENDING,
        },
      });
      if (!allocation)
        throw new NotFoundException(
          'Allocation awaiting activation not found.',
        );

      const inspection = await tx.inspection.findFirst({
        where: {
          clientId,
          allocationId,
          type: InspectionType.PRE_ALLOCATION,
          status: InspectionStatus.COMPLETED,
        },
      });
      if (!inspection)
        throw new ConflictException('Pre-allocation inspection is incomplete.');

      const handedOverAt = new Date();
      await this.commercial.activateInTransaction(tx, clientId, allocationId, handedOverAt);
      const activated = await tx.allocation.updateMany({
        where: {
          id: allocationId,
          clientId,
          status: AllocationStatus.OTP_PENDING,
        },
        data: { status: AllocationStatus.ACTIVE, allocatedAt: handedOverAt },
      });
      if (activated.count !== 1)
        throw new ConflictException(
          'Allocation state changed; retry the request.',
        );

      const fleet = await tx.fleet.updateMany({
        where: {
          id: allocation.fleetId,
          clientId,
          status: FleetStatus.RESERVED,
          deletedAt: null,
        },
        data: { status: FleetStatus.ALLOCATED },
      });
      if (fleet.count !== 1)
        throw new ConflictException(
          'Fleet is not reserved for this allocation.',
        );

      await this.notifications.enqueue(tx, clientId, allocationId, 'ACTIVATED');
      return { activated: true, allocationId };
    });
  }
  async initiateDeallocation(clientId: string, allocationId: string) {
    return this.prisma.$transaction(async (tx) => {
      return this.initiateDeallocationInTransaction(tx, clientId, allocationId);
    });
  }
  async initiateDeallocationInTransaction(
    tx: Prisma.TransactionClient,
    clientId: string,
    allocationId: string,
  ) {
    const allocation = await tx.allocation.findFirst({
      where: {
        id: allocationId,
        clientId,
        status: {
          in: [
            AllocationStatus.ACTIVE,
            AllocationStatus.DEALLOCATION_INITIATED,
          ],
        },
      },
    });
    if (!allocation) throw new NotFoundException('Active allocation not found.');
    if (allocation.status === AllocationStatus.ACTIVE) {
      await tx.allocation.update({
        where: { id: allocation.id },
        data: { status: AllocationStatus.DEALLOCATION_INITIATED },
      });
      await tx.fleet.updateMany({
        where: {
          id: allocation.fleetId,
          clientId,
          status: { in: [FleetStatus.ALLOCATED, FleetStatus.IN_USE] },
        },
        data: { status: FleetStatus.DEALLOCATION_IN_PROGRESS, allocationEnabled: false },
      });
    }
    const inspection = await tx.inspection.upsert({
      where: {
        allocationId_type: {
          allocationId: allocation.id,
          type: InspectionType.POST_DEALLOCATION,
        },
      },
      create: {
        clientId,
        allocationId: allocation.id,
        type: InspectionType.POST_DEALLOCATION,
        status: InspectionStatus.DRAFT,
      },
      update: {},
    });
    if (allocation.status === AllocationStatus.ACTIVE)
      await this.notifications.enqueue(tx, clientId, allocationId, 'RETURN_STARTED');
    return { allocationId: allocation.id, inspectionId: inspection.id };
  }
  async completeDeallocation(clientId: string, allocationId: string) {
    return this.prisma.$transaction(async (tx) => {
      return this.completeDeallocationInTransaction(tx, clientId, allocationId);
    });
  }

  /**
   * Finalize a post-deallocation inspection without duplicating the legacy
   * route's OTP and fleet-state rules. A physically received return is
   * identified by its RETURNED termination request; standalone legacy
   * deallocations still require both legacy OTPs.
   */
  async completeDeallocationInTransaction(
    tx: Prisma.TransactionClient,
    clientId: string,
    allocationId: string,
  ) {
    const allocation = await tx.allocation.findFirst({
      where: {
        id: allocationId,
        clientId,
        status: {
          in: [AllocationStatus.DEALLOCATION_INITIATED, AllocationStatus.OTP_PENDING],
        },
      },
    });
    if (!allocation) throw new NotFoundException('Deallocation not found.');

    const inspection = await tx.inspection.findFirst({
      where: {
        allocationId,
        type: InspectionType.POST_DEALLOCATION,
        status: InspectionStatus.COMPLETED,
      },
    });
    if (!inspection)
      throw new ConflictException('Post-deallocation inspection is incomplete.');

    const submission = await tx.vehicleSubmission.findUnique({ where: { allocationId } });
    const requiredReturn = await tx.rentalTerminationRequest.findFirst({ where: { clientId, allocationId, submissionRequired: true, status: { not: 'CANCELLED' } }, select: { id: true } });
    const requiredExchange = await tx.vehicleExchangeRequest.findFirst({ where: { clientId, oldAllocationId: allocationId, submissionRequired: true, status: { notIn: ['CANCELLED', 'REJECTED'] } }, select: { id: true } });
    if ((submission || requiredReturn || requiredExchange) && submission?.status !== 'CONFIRMED')
      throw new ConflictException('Vehicle photos, mechanic report and rider/team lead confirmation are required.');

    const receivedReturn = await tx.rentalTerminationRequest.findFirst({
      where: { clientId, allocationId, status: 'RETURNED' },
      select: { id: true },
    });
    if (receivedReturn && typeof inspection.safeForReuse !== 'boolean')
      throw new ConflictException('Return inspection safety outcome is required.');

    if (!receivedReturn && !submission) {
      const otps = await tx.otpRequest.findMany({
        where: {
          clientId,
          status: 'VERIFIED',
          purpose: { in: ['HANDOVER_RIDER', 'HANDOVER_OPERATOR'] },
        },
      });
      const purposes = new Set(
        otps
          .filter(
            (otp) =>
              (otp.context as { allocationId?: string } | null)?.allocationId ===
              allocationId,
          )
          .map((otp) => otp.purpose),
      );
      if (!purposes.has('HANDOVER_RIDER') || !purposes.has('HANDOVER_OPERATOR'))
        throw new ConflictException('Both deallocation OTPs must be verified.');
    }

    const safeForReuse = (inspection.safeForReuse ?? true) && (!submission || submission.mechanicChecksComplete);
    await tx.allocation.update({
      where: { id: allocationId },
      data: {
        status: AllocationStatus.COMPLETED,
        deallocatedAt: allocation.deallocatedAt ?? new Date(),
      },
    });
    await tx.fleet.update({
      where: { id: allocation.fleetId },
      data: {
        status: safeForReuse ? FleetStatus.AVAILABLE : FleetStatus.MAINTENANCE,
        allocationEnabled: safeForReuse,
      },
    });
    await this.notifications.enqueue(tx, clientId, allocationId, 'RETURN_COMPLETED');
    return { completed: true };
  }
}
