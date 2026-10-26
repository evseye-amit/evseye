import { pdiItems, riderPdiItems, riderPdiWorkflow } from './rider-pdi.js';
import { allocationPaymentView } from './allocation-payment-view.js';
import { pendingPenaltySummary } from '../submission-penalties/submission-penalty.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { ConfigService } from '@nestjs/config';
import { DeploymentCommercialService } from './deployment-commercial.service.js';
import { pendingRiderIdsQuery } from '../fleet-manager-home/home-metrics.js';
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { AllocationStatus, ClientSubscriptionStatus, DeploymentPaymentStatus, FleetStatus, InspectionStatus, InspectionType, MobileDeploymentStatus, PhotoStatus, Prisma, RiderStatus } from '@prisma/client';
import { STORAGE_PROVIDER, type StorageProvider } from '../media/storage/storage-provider.interface.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { translatedProperty, type ApiLocale } from '../common/locale.js';
import { AllocationsService } from './allocations.service.js';
import { MediaService } from '../media/media.service.js';
import type { CreateUploadIntentDto } from '../media/dto/create-upload-intent.dto.js';
import { ReferralQualificationService } from '../referrals/referral-qualification.service.js';

@Injectable()
export class MobileDeploymentService {
  private readonly logger = new Logger(MobileDeploymentService.name);
  @Inject(WalletService) private readonly wallet!: WalletService;
  @Inject(ConfigService) private readonly config!: ConfigService;

  private async riderHomeFinancials(clientId: string, userId: string) {
    const wallet = await this.wallet.riderWallet(clientId, userId);
    const { accounts: _accounts, ...balance } = await this.wallet.balance(clientId, wallet.id);
    const last = await this.prisma.walletTransaction.findFirst({
      where: { clientId, walletId: wallet.id, status: 'POSTED', transactionType: { in: ['REWARD', 'REFERRAL_REWARD', 'SELF_SUBMISSION_REWARD'] } },
      orderBy: [{ postedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, transactionType: true, amount: true, currency: true, description: true, postedAt: true },
    });
    return {
      wallet: { id: wallet.id, status: wallet.status, ...balance },
      lastEarnings: last ? { ...last, amount: last.amount.toFixed(2) } : null,
    };
  }

  private async frontInspectionPhoto(clientId: string, allocationId: string) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { clientId, allocationId, type: InspectionType.PRE_ALLOCATION },
      select: { id: true },
    });
    if (!inspection) return null;
    const photo = await this.prisma.photo.findFirst({
      where: { clientId, workFlowType: 'FLEET_ALLOTMENT', subjectType: 'FLEET', entityId: inspection.id, photoType: 'FRONT', status: PhotoStatus.COMPLETE },
      orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    if (!photo) return null;
    const { url } = await this.media.downloadUrl(clientId, photo.id);
    const ttl = this.config.get<number>('S3_SIGNED_URL_TTL_SECONDS');
    return { id: photo.id, url, expiresAt: ttl ? new Date(Date.now() + Number(ttl) * 1000).toISOString() : null };
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly allocations: AllocationsService,
    private readonly media: MediaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly commercial: DeploymentCommercialService,
    @Optional() private readonly referralQualification?: ReferralQualificationService,
  ) {}

  private async trainingPolicy(clientId: string) {
    const today = new Date();
    const subscription = await this.prisma.clientSubscription.findFirst({
      where: {
        clientId,
        status: ClientSubscriptionStatus.ACTIVE,
        startDate: { lte: today },
        OR: [{ endDate: null }, { endDate: { gte: today } }],
      },
      orderBy: { startDate: 'desc' },
      include: {
        package: {
          include: {
            features: {
              where: { isIncluded: true, feature: { code: 'SHOW_TRAINING', isActive: true } },
              include: {
                feature: {
                  include: {
                    trainingContents: { where: { isActive: true }, orderBy: { displayOrder: 'asc' } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!subscription) throw new BadRequestException('No active package is available for this Client.');
    return {
      included: subscription.package.features.length > 0,
      contents: subscription.package.features.flatMap((packageFeature) => packageFeature.feature.trainingContents),
    };
  }
  private async trainingContents(clientId: string) {
    return (await this.trainingPolicy(clientId)).contents;
  }
  private async workflow(clientId: string, allocationId: string) {
    const allocation = await this.prisma.allocation.findFirst({ where: { id: allocationId, clientId }, include: { rider: true, fleet: { include: { iotDevice: { include: { currentState: true } } } } } });
    if (!allocation) throw new NotFoundException('Allocation not found.');
    return { allocation, workflow: await this.prisma.mobileDeploymentWorkflow.upsert({ where: { allocationId }, create: { clientId, allocationId }, update: {} }) };
  }
  private async assertRiderAllocation(clientId: string, userId: string, allocationId: string) {
    const rider = await this.prisma.rider.findFirst({ where: { clientId, userId, deletedAt: null }, select: { id: true } });
    if (!rider || !(await this.prisma.allocation.findFirst({ where: { id: allocationId, clientId, riderId: rider.id }, select: { id: true } }))) throw new NotFoundException('Deployment request not found.');
  }
  private async assertFleetManagerHub(clientId: string, userId: string, allocationId: string) {
    const hubs = await this.prisma.userHub.findMany({ where: { clientId, userId, hub: { clientId, status: 'ACTIVE', deletedAt: null } }, select: { hubId: true } });
    if (!(await this.prisma.allocation.findFirst({ where: { id: allocationId, clientId, fleet: { currentHubId: { in: hubs.map((hub) => hub.hubId) } } }, select: { id: true } }))) throw new NotFoundException('Deployment request not found in an assigned Hub.');
  }
  private async allocationEvidence(clientId: string, allocationId: string) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { clientId, allocationId, type: InspectionType.PRE_ALLOCATION },
      include: {
        allocation: {
          select: {
            id: true,
            fleet: { select: { fleetCode: true, vehicleNumber: true } },
          },
        },
      },
    });
    if (!inspection) throw new NotFoundException('Allocation evidence record not found.');
    const [requirements, photos] = await Promise.all([
      this.prisma.photoRequirement.findMany({ where: { clientId, workFlowType: 'FLEET_ALLOTMENT', subjectType: 'FLEET' }, orderBy: [{ sortOrder: 'asc' }, { photoType: 'asc' }] }),
      this.prisma.photo.findMany({ where: { clientId, workFlowType: 'FLEET_ALLOTMENT', subjectType: 'FLEET', entityId: inspection.id }, orderBy: { uploadedAt: 'asc' } }),
    ]);
    const completed = new Set(photos.filter((photo) => photo.status === PhotoStatus.COMPLETE).map((photo) => photo.photoType));
    const missingPhotoTypes = requirements.filter((requirement) => requirement.isRequired && !completed.has(requirement.photoType)).map((requirement) => requirement.photoType);
    return { inspection, requirements, photos, missingPhotoTypes };
  }
  private async fleetManagerHubIds(clientId: string, userId: string) {
    return (await this.prisma.userHub.findMany({ where: { clientId, userId, hub: { clientId, status: 'ACTIVE', deletedAt: null } }, select: { hubId: true } })).map((entry) => entry.hubId);
  }
  async pendingRiders(clientId: string, userId: string, selectedHubId?: string) {
    const assigned = await this.prisma.userHub.findMany({ where: { clientId, userId, hub: { clientId, status: 'ACTIVE', deletedAt: null } }, select: { hubId: true } });
    const hubIds = assigned.map((item) => item.hubId);
    if (selectedHubId && !hubIds.includes(selectedHubId)) throw new NotFoundException('Hub not found in your active assigned hubs.');
    if (!hubIds.length) return [];
    const eligible = await this.prisma.$queryRaw<{ id: string }[]>(pendingRiderIdsQuery(clientId, selectedHubId ? [selectedHubId] : hubIds));
    return this.prisma.rider.findMany({
      where: {
        clientId,
        id: { in: eligible.map((item) => item.id) },
        status: RiderStatus.ACTIVE,
        deletedAt: null,
        allocations: { none: { OR: [{ status: { not: AllocationStatus.CANCELLED } }, { allocatedAt: { not: null } }] } },
      },
      select: { id: true, riderCode: true, name: true, mobile: true, joiningDate: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }
  async eligibleFleets(clientId: string, userId: string) {
    const hubIds = await this.fleetManagerHubIds(clientId, userId);
    if (!hubIds.length) return [];
    return this.prisma.fleet.findMany({
      where: { clientId, currentHubId: { in: hubIds }, status: FleetStatus.AVAILABLE, onboardingStatus: 'ACTIVE', allocationEnabled: true, deletedAt: null, allocations: { none: { status: { notIn: [AllocationStatus.COMPLETED, AllocationStatus.CANCELLED] } } } },
      select: { id: true, fleetCode: true, vehicleNumber: true, chassisNumber: true, currentHub: { select: { id: true, code: true, name: true } }, iotDevice: { select: { id: true, deviceNumber: true, lastHeartbeatAt: true } } },
      orderBy: { fleetCode: 'asc' },
    });
  }
  async allocateFleet(clientId: string, userId: string, riderId: string, fleetId: string) {
    const hubIds = await this.fleetManagerHubIds(clientId, userId);
    const fleet = await this.prisma.fleet.findFirst({ where: { id: fleetId, clientId, currentHubId: { in: hubIds }, status: FleetStatus.AVAILABLE, onboardingStatus: 'ACTIVE', allocationEnabled: true, deletedAt: null, allocations: { none: { status: { notIn: [AllocationStatus.COMPLETED, AllocationStatus.CANCELLED] } } } }, select: { id: true } });
    if (!fleet) throw new NotFoundException('An allocatable Fleet was not found in your assigned Hubs.');
    const rider = await this.prisma.rider.findFirst({ where: { id: riderId, clientId, status: RiderStatus.ACTIVE, deletedAt: null, allocations: { none: { status: { in: [AllocationStatus.INITIATED, AllocationStatus.INSPECTION_PENDING, AllocationStatus.OTP_PENDING, AllocationStatus.ACTIVE, AllocationStatus.DEALLOCATION_INITIATED] } } } }, select: { id: true } });
    if (!rider) throw new BadRequestException('This Rider is not awaiting Fleet allocation.');
    return this.allocations.initiate(clientId, fleetId, riderId, userId);
  }
  async fleetRequests(clientId: string, userId: string) {
    const hubIds = (await this.prisma.userHub.findMany({ where: { clientId, userId }, select: { hubId: true } })).map((entry) => entry.hubId);
    if (!hubIds.length) return [];
    const requests = await this.prisma.allocation.findMany({
      where: { clientId, fleet: { currentHubId: { in: hubIds } }, mobileDeployment: { is: { status: { in: ['RIDER_WAITING', 'FLEET_REQUESTED', 'PAYMENT_PENDING', 'PAYMENT_PAID', 'PDI_PENDING_RIDER', 'TRAINING_PENDING', 'DEVICE_PAIRING_PENDING'] } } } },
      include: { rider: true, fleet: { include: {
        iotDevice: true,
        batteryHistory: {
          where: { removedAt: null, battery: { clientId } },
          orderBy: { installedAt: 'asc' },
          select: { battery: { select: { batteryType: true, serialNumber: true } } },
        },
      } }, mobileDeployment: true },
    });
    if (!requests.length) return [];
    const photos = await this.prisma.photo.findMany({
      where: {
        clientId,

        workFlowType: 'FLEET_INSPECTION',
        subjectType: 'FLEET',
        entityId: { in: [...new Set(requests.map((request) => request.fleetId))] },
        status: PhotoStatus.COMPLETE,
      },
      orderBy: { uploadedAt: 'asc' },
    });
    const photosByFleet = new Map<string, typeof photos>();
    for (const photo of photos) {
      const fleetPhotos = photosByFleet.get(photo.entityId) ?? [];
      fleetPhotos.push(photo);
      photosByFleet.set(photo.entityId, fleetPhotos);
    }
    return requests.map((request) => ({
      ...request,
      fleet: { ...request.fleet, photos: photosByFleet.get(request.fleetId) ?? [] },
    }));
  }
  async riderCurrent(clientId: string, userId: string) {
    const rider = await this.prisma.rider.findFirst({ where: { clientId, userId, deletedAt: null }, select: { id: true } });
    if (!rider) return { screen: 'ONBOARDING' };
    const submissionPenalties = await pendingPenaltySummary(this.prisma, clientId, rider.id);
    let allocation = await this.prisma.allocation.findFirst({ where: { clientId, riderId: rider.id, status: { notIn: [AllocationStatus.COMPLETED, AllocationStatus.CANCELLED] }, mobileDeployment: { isNot: null } }, orderBy: { updatedAt: 'desc' }, include: { fleet: true, mobileDeployment: true } });
    if (!allocation?.mobileDeployment) {
      const handedOver = await this.prisma.allocation.findFirst({
        where: { clientId, riderId: rider.id, OR: [{ status: AllocationStatus.COMPLETED }, { allocatedAt: { not: null } }] },
        select: { id: true },
      });
      return {
        screen: handedOver ? 'HOME' : 'WAITING', submissionPenalties, allocation: null, workflow: null, payment: null, commercial: null,
        ...(handedOver ? await this.riderHomeFinancials(clientId, userId) : { wallet: null, lastEarnings: null }),
      };
    }
    if (allocation.mobileDeployment.status === MobileDeploymentStatus.TRAINING_PENDING && !(await this.trainingPolicy(clientId)).included) {
      await this.completeTraining(clientId, userId, allocation.id);
      allocation = await this.prisma.allocation.findFirst({ where: { id: allocation.id, clientId, riderId: rider.id, status: { notIn: [AllocationStatus.COMPLETED, AllocationStatus.CANCELLED] } }, include: { fleet: true, mobileDeployment: true } });
      if (!allocation?.mobileDeployment) throw new NotFoundException('Deployment request not found.');
    }
    const status = allocation.mobileDeployment.status;
    let screen = ({ PAYMENT_PENDING: 'PAYMENT', PDI_PENDING_RIDER: 'PDI', TRAINING_PENDING: 'TRAINING', DEVICE_PAIRING_PENDING: 'TRAINING', DEPLOYED: 'HOME' } as Record<string, string>)[status] ?? 'WAITING';
    const payment = await this.prisma.deploymentPayment.findUnique({ where: { workflowId: allocation.mobileDeployment.id } });
    const commercial = allocation.commercialOfferId ? await this.commercial.getOffer(clientId, { id: userId, clientId, roles: [] }, allocation.id, true) : null;
    if (!allocation.rentalAgreementId && commercial?.offer?.status === 'PRESENTED') screen = 'PLAN_ACCEPTANCE';
    const frontPhoto = await this.frontInspectionPhoto(clientId, allocation.id);
    return {
      screen, submissionPenalties, allocation: { ...allocation, mobileDeployment: riderPdiWorkflow(allocation.mobileDeployment), fleet: { ...allocation.fleet, frontPhoto } },
      workflow: riderPdiWorkflow(allocation.mobileDeployment), payment, commercial,
      ...(screen === 'HOME' ? await this.riderHomeFinancials(clientId, userId) : { wallet: null, lastEarnings: null }),
    };
  }
  async riderWallet(clientId: string, userId: string) {
    const rider = await this.prisma.rider.findFirst({ where: { clientId, userId, deletedAt: null }, select: { id: true } });
    if (!rider) return { currency: 'INR', amountDue: '0.00', currentPayment: null, payments: [] };
    const payments = await this.prisma.deploymentPayment.findMany({
      where: { clientId, workflow: { allocation: { riderId: rider.id } } },
      include: {
        workflow: {
          select: {
            allocation: {
              select: {
                id: true,
                fleet: { select: { fleetCode: true, vehicleNumber: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    const open = payments.find((payment) => payment.status === DeploymentPaymentStatus.PENDING || payment.status === DeploymentPaymentStatus.SUBMITTED || payment.status === DeploymentPaymentStatus.REJECTED) ?? null;
    const amountDue = open?.amount.toFixed(2) ?? '0.00';
    return {
      currency: open?.currency ?? payments[0]?.currency ?? 'INR',
      amountDue,
      currentPayment: open && {
        id: open.id,
        source: 'DEPLOYMENT',
        submissionVersion: open.submissionVersion,
        rejectionReason: open.rejectionReason,
        rejectedAt: open.rejectedAt,
        status: open.status,
        amount: open.amount.toFixed(2),
        currency: open.currency,
        breakdown: open.breakdown,
        provider: open.provider,
        providerReference: open.providerReference,
        fleet: open.workflow.allocation.fleet,
        createdAt: open.createdAt,
      },
      payments: payments.map((payment) => ({
        id: payment.id,
        source: 'DEPLOYMENT',
        submissionVersion: payment.submissionVersion,
        rejectionReason: payment.rejectionReason,
        rejectedAt: payment.rejectedAt,
        status: payment.status,
        amount: payment.amount.toFixed(2),
        currency: payment.currency,
        breakdown: payment.breakdown,
        provider: payment.provider,
        providerReference: payment.providerReference,
        submittedAt: payment.submittedAt,
        paidAt: payment.paidAt,
        fleet: payment.workflow.allocation.fleet,
        createdAt: payment.createdAt,
      })),
    };
  }
  async requestFleet(clientId: string, userId: string, allocationId: string) {
    await this.assertFleetManagerHub(clientId, userId, allocationId);
    const { workflow } = await this.workflow(clientId, allocationId);
    if (workflow.status !== MobileDeploymentStatus.RIDER_WAITING) throw new BadRequestException('Fleet request is not available in the current state.');
    return this.prisma.mobileDeploymentWorkflow.update({ where: { id: workflow.id }, data: { status: MobileDeploymentStatus.FLEET_REQUESTED } });
  }
  async askPayment(clientId: string, userId: string, allocationId: string, _request?: unknown) {
    await this.assertFleetManagerHub(clientId, userId, allocationId);
    return this.commercial.requestPayment(clientId, allocationId);
  }
  async payment(clientId: string, userId: string, allocationId: string) {
    await this.assertRiderAllocation(clientId, userId, allocationId);
    const { workflow } = await this.workflow(clientId, allocationId);
    const payment = await this.prisma.deploymentPayment.findUnique({ where: { workflowId: workflow.id } });
    if (!payment) throw new NotFoundException('Payment request not found.');
    const receipts = await this.prisma.photo.findMany({ where: { clientId, workFlowType: 'PAYMENT', subjectType: 'OTHER', entityId: payment.id, status: 'COMPLETE' },
      select: { id: true, mimeType: true, sizeBytes: true, uploadedAt: true }, orderBy: { createdAt: 'asc' } });
    return { ...allocationPaymentView(payment, workflow.status), receipts };
  }
  async submitPaymentReference(clientId: string, userId: string, allocationId: string, provider: string, providerReference: string, receiptPhotoIds: string[] = []) {
    await this.assertRiderAllocation(clientId, userId, allocationId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Allocation" WHERE id = ${allocationId} AND "clientId" = ${clientId} FOR UPDATE`;
        const allocation = await tx.allocation.findFirst({ where: { id: allocationId, clientId }, include: { mobileDeployment: { include: { payment: true } } } });
        const workflow = allocation?.mobileDeployment, payment = workflow?.payment;
        if (!workflow || !payment) throw new NotFoundException('Payment request not found.');
        provider = provider.trim(); providerReference = providerReference.trim();
        if (!provider || !providerReference) throw new BadRequestException('Payment provider and reference are required.');
        if (receiptPhotoIds.length > 20 || new Set(receiptPhotoIds).size !== receiptPhotoIds.length)
          throw new BadRequestException('Provide up to 20 unique receipt photo IDs.');
        const receipts = await tx.photo.findMany({ where: { clientId, workFlowType: 'PAYMENT', subjectType: 'OTHER', entityId: payment.id, status: 'COMPLETE', uploadedById: userId },
          select: { id: true, mimeType: true, sizeBytes: true, uploadedAt: true }, orderBy: { createdAt: 'asc' } });
        if (receiptPhotoIds.some(id => !receipts.some(photo => photo.id === id)))
          throw new BadRequestException('Each receipt must be a completed upload for this payment.');
        if (['SUBMITTED', 'PAID'].includes(payment.status) && payment.provider === provider && payment.providerReference === providerReference)
          return { ...allocationPaymentView(payment, workflow.status), receipts };
        if (workflow.status !== MobileDeploymentStatus.PAYMENT_PENDING) throw new BadRequestException('No payment is pending.');
        if (payment.status !== 'PENDING' && payment.status !== 'REJECTED') throw new BadRequestException('This payment cannot be submitted in its current state.');
        const submitted = await tx.deploymentPayment.update({ where: { id: payment.id }, data: {
          status: 'SUBMITTED', provider, providerReference, submittedAt: new Date(), submissionVersion: { increment: 1 },
          rejectionReason: null, rejectedAt: null, rejectedById: null,
        } });
        await tx.auditLog.create({ data: { clientId, actorId: userId, action: 'PAYMENT_SUBMITTED', entityType: 'DeploymentPayment', entityId: payment.id,
          newData: { provider, providerReference, submissionVersion: submitted.submissionVersion, receiptPhotoIds: receipts.map(photo => photo.id) } } });
        return { ...allocationPaymentView(submitted, workflow.status), receipts };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new BadRequestException('This payment reference has already been used.');
      throw error;
    }
  }
  async rejectPayment(clientId: string, userId: string, allocationId: string, reason: string, expectedVersion: number) {
    await this.assertFleetManagerHub(clientId, userId, allocationId);
    return this.commercial.rejectPayment(clientId, userId, allocationId, reason, expectedVersion);
  }

  async verifyPayment(clientId: string, userId: string, allocationId: string, expectedVersion?: number) {
    await this.assertFleetManagerHub(clientId, userId, allocationId);
    return this.commercial.verifyPayment(clientId, userId, allocationId, expectedVersion);
  }
  async getAllocationEvidence(clientId: string, userId: string, allocationId: string) {
    await this.assertFleetManagerHub(clientId, userId, allocationId);
    return this.allocationEvidence(clientId, allocationId);
  }
  async submitPdi(clientId: string, userId: string, allocationId: string, workPartnerName: string | undefined, checklist: unknown, clientWorkPartnerId?: string) {
    await this.assertFleetManagerHub(clientId, userId, allocationId);
    const { workflow } = await this.workflow(clientId, allocationId);
    if (workflow.status !== MobileDeploymentStatus.PAYMENT_PAID) throw new BadRequestException('Payment is required before PDI.');
    const evidence = await this.allocationEvidence(clientId, allocationId);
    if (evidence.missingPhotoTypes.length) throw new BadRequestException({ message: 'Allocation evidence is incomplete.', missing: evidence.missingPhotoTypes, inspectionId: evidence.inspection.id });
    return this.prisma.$transaction(async (tx) => {
      const workPartner = await this.resolvePdiWorkPartner(tx, clientId, workPartnerName, clientWorkPartnerId);
      await tx.inspection.update({ where: { id: evidence.inspection.id }, data: { status: InspectionStatus.COMPLETED, completedBy: userId, completedAt: new Date(), checklist: checklist as never } });
      await tx.allocation.updateMany({
        where: { id: allocationId, clientId, status: AllocationStatus.INSPECTION_PENDING },
        data: { status: AllocationStatus.OTP_PENDING },
      });
      return tx.mobileDeploymentWorkflow.update({ where: { id: workflow.id }, data: { status: MobileDeploymentStatus.PDI_PENDING_RIDER, clientWorkPartnerId: workPartner.id ?? null, workPartnerName: workPartner.name, pdiChecklist: checklist as never } });
    });
  }

  private async resolvePdiWorkPartner(
    tx: Prisma.TransactionClient,
    clientId: string,
    workPartnerName: string | undefined,
    clientWorkPartnerId: string | undefined,
  ) {
    if (clientWorkPartnerId) {
      const partner = await tx.clientWorkPartner.findUnique({
        where: { clientId_id: { clientId, id: clientWorkPartnerId } },
      });
      if (!partner || partner.clientId !== clientId) throw new NotFoundException('Work partner not found.');
      if (partner.status !== 'ACTIVE') throw new ConflictException('Select an active work partner.');
      return { id: partner.id, name: partner.name.trim() };
    }

    const name = workPartnerName?.trim() ?? '';
    if (!name) throw new BadRequestException('Work Partner name is required for PDI handover.');

    const partners = await tx.clientWorkPartner.findMany({ where: { clientId } });
    if (!partners.length) return { id: undefined, name };

    const matches = partners.filter((partner) => partner.name.trim().toLowerCase() === name.toLowerCase());
    if (matches.length !== 1) throw new ConflictException('Work Partner name must match exactly one client work partner.');
    if (matches[0].status !== 'ACTIVE') throw new ConflictException('Select an active work partner.');
    return { id: matches[0].id, name: matches[0].name.trim() };
  }
  async createPdiVoiceUploadIntent(clientId: string, userId: string, allocationId: string, input: { itemCode: string; mimeType: 'audio/mpeg' | 'audio/mp4' | 'audio/wav' | 'audio/ogg'; fileName: string; sizeBytes: number }) {
    await this.assertRiderAllocation(clientId, userId, allocationId);
    const { workflow } = await this.workflow(clientId, allocationId);
    if (workflow.status !== MobileDeploymentStatus.PDI_PENDING_RIDER) throw new BadRequestException('PDI is not awaiting Rider acceptance.');
    if (!riderPdiItems(workflow.pdiChecklist).some(item => item.code === input.itemCode)) throw new BadRequestException('Voice remarks are only available for mandatory PDI items. Refresh the checklist.');
    const evidence = await this.allocationEvidence(clientId, allocationId);
    const dto: CreateUploadIntentDto = {
      workFlowType: 'FLEET_ALLOTMENT',
      subjectType: 'FLEET',
      entityId: evidence.inspection.id,
      photoType: 'FACE',
      mimeType: input.mimeType as CreateUploadIntentDto['mimeType'],
      fileName: input.fileName,
      sizeBytes: input.sizeBytes,
    };
    return this.media.createUploadIntent(clientId, userId, dto);
  }
  async completePdiVoiceUpload(clientId: string, userId: string, allocationId: string, photoId: string) {
    await this.assertRiderAllocation(clientId, userId, allocationId);
    const { workflow } = await this.workflow(clientId, allocationId);
    if (workflow.status !== MobileDeploymentStatus.PDI_PENDING_RIDER) throw new BadRequestException('PDI is not awaiting Rider acceptance.');
    const evidence = await this.allocationEvidence(clientId, allocationId);
    const photo = await this.prisma.photo.findFirst({ where: { id: photoId, clientId, workFlowType: 'FLEET_ALLOTMENT', subjectType: 'FLEET', entityId: evidence.inspection.id, photoType: 'FACE' }, select: { id: true, photoType: true } });
    if (!photo || !riderPdiItems(workflow.pdiChecklist).length) throw new NotFoundException('PDI voice upload not found for a mandatory checklist item.');
    return this.media.complete(clientId, photo.id);
  }
  async acceptPdi(clientId: string, userId: string, allocationId: string, items: Array<{ code: string; accepted: boolean; remarksText?: string; voiceMediaId?: string }>) {
    await this.assertRiderAllocation(clientId, userId, allocationId);
    const { workflow } = await this.workflow(clientId, allocationId);
    if (workflow.status !== MobileDeploymentStatus.PDI_PENDING_RIDER) throw new BadRequestException('PDI is not awaiting Rider acceptance.');
    const fullChecklist = pdiItems(workflow.pdiChecklist);
    if (!Array.isArray(workflow.pdiChecklist) || !fullChecklist.length || fullChecklist.length !== workflow.pdiChecklist.length || new Set(fullChecklist.map(item => item.code)).size !== fullChecklist.length) throw new BadRequestException('PDI checklist is unavailable. Ask your Fleet Manager to resubmit it.');
    const checklist = riderPdiItems(workflow.pdiChecklist);
    const allowedCodes = new Set(checklist.map(item => item.code));
    if (new Set(items.map(item => item.code)).size !== items.length) throw new BadRequestException('Provide one acknowledgement per mandatory PDI item.');
    if (items.some(item => !allowedCodes.has(item.code))) throw new BadRequestException('Only mandatory PDI items can be acknowledged. Refresh the checklist.');
    for (const item of checklist) {
      const response = items.find(candidate => candidate.code === item.code);
      if (!response) throw new BadRequestException(`PDI item ${item.code} has not been acknowledged.`);
      if (!response.accepted && !response.remarksText?.trim() && !response.voiceMediaId) throw new BadRequestException(`A text or voice remark is required for rejected PDI item ${item.code}.`);
    }
    const voiceMediaIds = [...new Set(items.flatMap(item => item.voiceMediaId ? [item.voiceMediaId] : []))];
    if (voiceMediaIds.length) {
      const evidence = await this.allocationEvidence(clientId, allocationId);
      const voiceNotes = await this.prisma.photo.findMany({ where: { id: { in: voiceMediaIds }, clientId, workFlowType: 'FLEET_ALLOTMENT', subjectType: 'FLEET', entityId: evidence.inspection.id, status: PhotoStatus.COMPLETE }, select: { id: true, photoType: true } });
      if (items.some(item => item.voiceMediaId && !voiceNotes.some(photo => photo.id === item.voiceMediaId && photo.photoType === 'FACE'))) throw new BadRequestException('Each PDI voice remark must be a completed voice upload for its mandatory item and this allocation.');
    }
    const policy = await this.trainingPolicy(clientId);
    const acceptance = { riderPdiAcceptedAt: new Date(), riderPdiRemarksText: JSON.stringify(items), riderPdiVoicePhotoId: items.find((item) => item.voiceMediaId)?.voiceMediaId };
    if (policy.included) return riderPdiWorkflow(await this.prisma.mobileDeploymentWorkflow.update({ where: { id: workflow.id }, data: { ...acceptance, status: MobileDeploymentStatus.TRAINING_PENDING } }));
    const deployed = await this.prisma.$transaction(tx => this.completeDeployment(tx, clientId, allocationId, workflow.id, acceptance));
    await this.referralAllocated(clientId, allocationId);
    return riderPdiWorkflow(deployed);
  }
  async training(clientId: string, userId: string, allocationId: string, locale: ApiLocale = 'en') {
    await this.assertRiderAllocation(clientId, userId, allocationId);
    const { workflow } = await this.workflow(clientId, allocationId);
    if (workflow.status !== MobileDeploymentStatus.TRAINING_PENDING && workflow.status !== MobileDeploymentStatus.DEVICE_PAIRING_PENDING) throw new BadRequestException('Training is not pending.');
    const viewed = Array.isArray(workflow.trainingViewedContentCodes) ? workflow.trainingViewedContentCodes.map(String) : [];
    const contents = await this.trainingContents(clientId);
    return Promise.all(contents.map(async (content) => ({
      code: content.code,
      title: translatedProperty(content.title, content.translations, locale, 'title'),
      description: translatedProperty(content.description, content.translations, locale, 'description'),
      isMandatory: content.isMandatory,
      displayOrder: content.displayOrder,
      viewed: viewed.includes(content.code),
      downloadUrl: await this.storage.createDownloadUrl(content.imageObjectKey),
    })));
  }
  async markTrainingViewed(clientId: string, userId: string, allocationId: string, contentCode: string) {
    await this.assertRiderAllocation(clientId, userId, allocationId);
    const { workflow } = await this.workflow(clientId, allocationId);
    if (workflow.status !== MobileDeploymentStatus.TRAINING_PENDING && workflow.status !== MobileDeploymentStatus.DEVICE_PAIRING_PENDING) throw new BadRequestException('Training is not pending.');
    const contents = await this.trainingContents(clientId);
    if (!contents.some((content) => content.code === contentCode)) throw new BadRequestException('Training content is not available in the active package.');
    const viewed = Array.isArray(workflow.trainingViewedContentCodes) ? workflow.trainingViewedContentCodes.map(String) : [];
    const nextViewed = [...new Set([...viewed, contentCode])];
    return riderPdiWorkflow(await this.prisma.mobileDeploymentWorkflow.update({ where: { id: workflow.id }, data: { trainingViewedContentCodes: nextViewed } }));
  }
  async completeTraining(clientId: string, userId: string, allocationId: string) {
    await this.assertRiderAllocation(clientId, userId, allocationId);
    const { workflow } = await this.workflow(clientId, allocationId);
    if (workflow.status === MobileDeploymentStatus.DEPLOYED) return riderPdiWorkflow(workflow);
    if (workflow.status !== MobileDeploymentStatus.TRAINING_PENDING && workflow.status !== MobileDeploymentStatus.DEVICE_PAIRING_PENDING) throw new BadRequestException('Training is not pending.');
    let trainingCompletedAt = workflow.trainingCompletedAt;
    // Existing pairing-pending workflows have already completed their training.
    if (workflow.status !== MobileDeploymentStatus.DEVICE_PAIRING_PENDING || !workflow.trainingCompletedAt) {
      const policy = await this.trainingPolicy(clientId);
      const mandatory = policy.contents.filter((content) => content.isMandatory).map((content) => content.code);
      const viewed = Array.isArray(workflow.trainingViewedContentCodes) ? workflow.trainingViewedContentCodes.map(String) : [];
      const missing = mandatory.filter((code) => !viewed.includes(code));
      if (missing.length) throw new BadRequestException(`Complete mandatory training content first: ${missing.join(', ')}.`);
      if (policy.included) trainingCompletedAt ??= new Date();
    }
    const deployed = await this.prisma.$transaction((tx) => this.completeDeployment(tx, clientId, allocationId, workflow.id, {
      trainingCompletedAt,
    }));
    await this.referralAllocated(clientId, allocationId);
    return riderPdiWorkflow(deployed);
  }
  async iotHealth(clientId: string, userId: string, allocationId: string) {
    await this.assertFleetManagerHub(clientId, userId, allocationId);
    const { allocation, workflow } = await this.workflow(clientId, allocationId);
    const device = allocation.fleet.iotDevice;
    if (!device) throw new BadRequestException('No IoT device is mapped to this Fleet.');
    const heartbeatAt = device.currentState?.lastHeartbeatAt ?? device.lastHeartbeatAt;
    const heartbeatAgeSeconds = heartbeatAt ? Math.max(0, Math.floor((Date.now() - heartbeatAt.getTime()) / 1000)) : null;
    const heartbeatFresh = heartbeatAgeSeconds !== null && heartbeatAgeSeconds <= 15 * 60;
    const simStatus = !device.simNumber ? 'NOT_CONFIGURED' : device.status !== 'ACTIVE' ? 'DEVICE_INACTIVE' : heartbeatFresh ? 'CONNECTED' : 'UNKNOWN';
    const workingCondition = device.status === 'ACTIVE' && heartbeatFresh && device.currentState?.isOnline ? 'HEALTHY' : 'ATTENTION_REQUIRED';
    return {
      deploymentStatus: workflow.status,
      device: { id: device.id, deviceNumber: device.deviceNumber, imei: device.imei, model: device.model, provider: device.provider },
      heartbeat: { receivedAt: heartbeatAt, ageSeconds: heartbeatAgeSeconds, isFresh: heartbeatFresh, isOnline: Boolean(device.currentState?.isOnline) },
      sim: { status: simStatus, numberLastFour: device.simNumber?.slice(-4) ?? null, iccidLastFour: device.iccid?.slice(-4) ?? null, provider: device.provider ?? null },
      workingCondition,
    };
  }
  private async completeDeployment(
    tx: Prisma.TransactionClient,
    clientId: string,
    allocationId: string,
    workflowId: string,
    workflowData: Prisma.MobileDeploymentWorkflowUpdateInput,
  ) {
    await tx.$queryRaw`SELECT id FROM "Allocation" WHERE id = ${allocationId} AND "clientId" = ${clientId} FOR UPDATE`;
    const allocation = await tx.allocation.findFirst({
      where: { id: allocationId, clientId, status: { in: [AllocationStatus.OTP_PENDING, AllocationStatus.INSPECTION_PENDING] } },
      select: { fleetId: true, status: true },
    });
    if (!allocation) throw new BadRequestException('The allocation is not ready for deployment. Complete PDI first.');
    // Older mobile PDI submissions completed the inspection without advancing the allocation.
    if (allocation.status === AllocationStatus.INSPECTION_PENDING) {
      const inspection = await tx.inspection.findFirst({
        where: { clientId, allocationId, type: InspectionType.PRE_ALLOCATION, status: InspectionStatus.COMPLETED },
        select: { id: true },
      });
      if (!inspection) throw new BadRequestException('The allocation is not ready for deployment. Complete PDI first.');
    }

    const handedOverAt = new Date();
    await this.commercial.activateInTransaction(tx, clientId, allocationId, handedOverAt);
    const fleet = await tx.fleet.updateMany({
      where: { id: allocation.fleetId, clientId, status: FleetStatus.RESERVED, deletedAt: null },
      data: { status: FleetStatus.ALLOCATED },
    });
    if (fleet.count !== 1) throw new BadRequestException('The selected Fleet is no longer reserved for this deployment.');

    const activated = await tx.allocation.updateMany({
      where: { id: allocationId, clientId, status: allocation.status },
      data: { status: AllocationStatus.ACTIVE, allocatedAt: handedOverAt },
    });
    if (activated.count !== 1) throw new BadRequestException('The allocation status changed. Refresh and try again.');

    return tx.mobileDeploymentWorkflow.update({
      where: { id: workflowId },
      data: { ...workflowData, status: MobileDeploymentStatus.DEPLOYED },
    });
  }
  async pair(clientId: string, userId: string, allocationId: string, _deviceNumber: string) {
    // Compatibility for older apps: pairing no longer gates deployment.
    return this.completeTraining(clientId, userId, allocationId);
  }
  async bypassPairing(clientId: string, userId: string, allocationId: string, remarks: string) {
    await this.assertFleetManagerHub(clientId, userId, allocationId);
    const { workflow } = await this.workflow(clientId, allocationId);
    if (workflow.status !== MobileDeploymentStatus.DEVICE_PAIRING_PENDING) throw new BadRequestException('Device pairing is not pending.');
    if (!remarks.trim()) throw new BadRequestException('A bypass reason is required.');
    const deployed = await this.prisma.$transaction((tx) => this.completeDeployment(tx, clientId, allocationId, workflow.id, {
      pairingBypassedAt: new Date(),
      pairingBypassedById: userId,
      pairingBypassReason: remarks.trim(),
    }));
    await this.referralAllocated(clientId, allocationId);
    return deployed;
  }
  private async referralAllocated(clientId: string, allocationId: string) {
    if (!this.referralQualification) return;
    try {
      const allocation = await this.prisma.allocation.findFirst({ where: { id: allocationId, clientId, status: 'ACTIVE' }, select: { riderId: true } });
      if (allocation) await this.referralQualification.recordEvent(clientId, allocation.riderId, 'VEHICLE_ALLOCATED', `allocation-active:${allocationId}`, '1');
    } catch (cause) { this.logger.error(`Referral allocation update failed for ${allocationId}`, cause); }
  }
}
