import { DeploymentCommercialService } from './deployment-commercial.service.js';
import { pendingRiderIdsQuery } from '../fleet-manager-home/home-metrics.js';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { AllocationStatus, ClientSubscriptionStatus, DeploymentPaymentStatus, FleetStatus, InspectionStatus, InspectionType, MobileDeploymentStatus, PhotoEntityType, PhotoStatus, Prisma, RiderStatus } from '@prisma/client';
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
      this.prisma.photoRequirement.findMany({ where: { clientId, entityType: PhotoEntityType.INSPECTION }, orderBy: [{ sortOrder: 'asc' }, { photoType: 'asc' }] }),
      this.prisma.photo.findMany({ where: { clientId, entityType: PhotoEntityType.INSPECTION, entityId: inspection.id }, orderBy: { uploadedAt: 'asc' } }),
    ]);
    const completed = new Set(photos.filter((photo) => photo.status === PhotoStatus.COMPLETE).map((photo) => photo.photoType));
    const missingPhotoTypes = requirements.filter((requirement) => requirement.isRequired && !completed.has(requirement.photoType)).map((requirement) => requirement.photoType);
    return { inspection, requirements, photos, missingPhotoTypes };
  }
  private async fleetManagerHubIds(clientId: string, userId: string) {
    return (await this.prisma.userHub.findMany({ where: { clientId, userId }, select: { hubId: true } })).map((entry) => entry.hubId);
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
      include: { rider: true, fleet: { include: { iotDevice: true } }, mobileDeployment: true },
    });
    if (!requests.length) return [];
    const photos = await this.prisma.photo.findMany({
      where: {
        clientId,
        entityType: PhotoEntityType.FLEET,
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
    let allocation = await this.prisma.allocation.findFirst({ where: { clientId, riderId: rider.id, mobileDeployment: { isNot: null } }, orderBy: { updatedAt: 'desc' }, include: { fleet: true, mobileDeployment: true } });
    if (!allocation?.mobileDeployment) return { screen: 'WAITING' };
    if (allocation.mobileDeployment.status === MobileDeploymentStatus.TRAINING_PENDING && !(await this.trainingPolicy(clientId)).included) {
      await this.completeTraining(clientId, userId, allocation.id);
      allocation = await this.prisma.allocation.findFirst({ where: { id: allocation.id, clientId, riderId: rider.id }, include: { fleet: true, mobileDeployment: true } });
      if (!allocation?.mobileDeployment) throw new NotFoundException('Deployment request not found.');
    }
    const status = allocation.mobileDeployment.status;
    let screen = ({ PAYMENT_PENDING: 'PAYMENT', PDI_PENDING_RIDER: 'PDI', TRAINING_PENDING: 'TRAINING', DEVICE_PAIRING_PENDING: 'TRAINING', DEPLOYED: 'HOME' } as Record<string, string>)[status] ?? 'WAITING';
    const payment = await this.prisma.deploymentPayment.findUnique({ where: { workflowId: allocation.mobileDeployment.id } });
    const commercial = allocation.commercialOfferId ? await this.commercial.getOffer(clientId, { id: userId, clientId, roles: [] }, allocation.id, true) : null;
    if (!allocation.rentalAgreementId && commercial?.offer?.status === 'PRESENTED') screen = 'PLAN_ACCEPTANCE';
    return { screen, allocation, workflow: allocation.mobileDeployment, payment, commercial };
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
    const open = payments.find((payment) => payment.status === DeploymentPaymentStatus.PENDING || payment.status === DeploymentPaymentStatus.SUBMITTED) ?? null;
    const amountDue = open?.amount.toFixed(2) ?? '0.00';
    return {
      currency: open?.currency ?? payments[0]?.currency ?? 'INR',
      amountDue,
      currentPayment: open && {
        id: open.id,
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
    const { workflow, allocation } = await this.workflow(clientId, allocationId);
    if (workflow.status !== MobileDeploymentStatus.RIDER_WAITING) throw new BadRequestException('Fleet request is not available in the current state.');
    const required = await this.prisma.photoRequirement.findMany({ where: { clientId, entityType: 'FLEET', isRequired: true }, select: { photoType: true } });
    const complete = await this.prisma.photo.findMany({ where: { clientId, entityType: 'FLEET', entityId: allocation.fleetId, status: 'COMPLETE' }, select: { photoType: true } });
    const missing = required.map((item) => item.photoType).filter((type) => !complete.some((photo) => photo.photoType === type));
    if (missing.length) throw new BadRequestException(`Fleet evidence is incomplete: ${missing.join(', ')}.`);
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
    return payment;
  }
  async submitPaymentReference(clientId: string, userId: string, allocationId: string, provider: string, providerReference: string) {
    await this.assertRiderAllocation(clientId, userId, allocationId);
    const { workflow } = await this.workflow(clientId, allocationId);
    if (workflow.status !== MobileDeploymentStatus.PAYMENT_PENDING) throw new BadRequestException('No payment is pending.');
    const payment = await this.prisma.deploymentPayment.findUnique({ where: { workflowId: workflow.id } });
    if (!payment) throw new NotFoundException('Payment request not found.');
    if (payment.status === DeploymentPaymentStatus.SUBMITTED && payment.providerReference === providerReference.trim()) return payment;
    if (payment.status !== DeploymentPaymentStatus.PENDING) throw new BadRequestException('This payment cannot be submitted in its current state.');
    try {
      return await this.prisma.deploymentPayment.update({ where: { id: payment.id }, data: { status: DeploymentPaymentStatus.SUBMITTED, provider: provider.trim(), providerReference: providerReference.trim(), submittedAt: new Date() } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new BadRequestException('This payment reference has already been used.');
      throw error;
    }
  }
  async verifyPayment(clientId: string, userId: string, allocationId: string) {
    await this.assertFleetManagerHub(clientId, userId, allocationId);
    return this.commercial.verifyPayment(clientId, userId, allocationId);
  }
  async getAllocationEvidence(clientId: string, userId: string, allocationId: string) {
    await this.assertFleetManagerHub(clientId, userId, allocationId);
    return this.allocationEvidence(clientId, allocationId);
  }
  async submitPdi(clientId: string, userId: string, allocationId: string, workPartnerName: string, checklist: unknown) {
    await this.assertFleetManagerHub(clientId, userId, allocationId);
    const { workflow } = await this.workflow(clientId, allocationId);
    if (workflow.status !== MobileDeploymentStatus.PAYMENT_PAID) throw new BadRequestException('Payment is required before PDI.');
    if (!workPartnerName.trim()) throw new BadRequestException('Work Partner name is required for PDI handover.');
    const evidence = await this.allocationEvidence(clientId, allocationId);
    if (evidence.missingPhotoTypes.length) throw new BadRequestException({ message: 'Allocation evidence is incomplete.', missing: evidence.missingPhotoTypes, inspectionId: evidence.inspection.id });
    return this.prisma.$transaction(async (tx) => {
      await tx.inspection.update({ where: { id: evidence.inspection.id }, data: { status: InspectionStatus.COMPLETED, completedBy: userId, completedAt: new Date(), checklist: checklist as never } });
      await tx.allocation.updateMany({
        where: { id: allocationId, clientId, status: AllocationStatus.INSPECTION_PENDING },
        data: { status: AllocationStatus.OTP_PENDING },
      });
      return tx.mobileDeploymentWorkflow.update({ where: { id: workflow.id }, data: { status: MobileDeploymentStatus.PDI_PENDING_RIDER, workPartnerName: workPartnerName.trim(), pdiChecklist: checklist as never } });
    });
  }
  async createPdiVoiceUploadIntent(clientId: string, userId: string, allocationId: string, input: { itemCode: string; mimeType: 'audio/mpeg' | 'audio/mp4' | 'audio/wav' | 'audio/ogg'; fileName: string; sizeBytes: number }) {
    await this.assertRiderAllocation(clientId, userId, allocationId);
    const { workflow } = await this.workflow(clientId, allocationId);
    if (workflow.status !== MobileDeploymentStatus.PDI_PENDING_RIDER) throw new BadRequestException('PDI is not awaiting Rider acceptance.');
    const evidence = await this.allocationEvidence(clientId, allocationId);
    const dto: CreateUploadIntentDto = {
      entityType: PhotoEntityType.INSPECTION,
      entityId: evidence.inspection.id,
      photoType: `PDI_VOICE_${input.itemCode}`,
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
    const photo = await this.prisma.photo.findFirst({ where: { id: photoId, clientId, entityType: PhotoEntityType.INSPECTION, entityId: evidence.inspection.id, photoType: { startsWith: 'PDI_VOICE_' } }, select: { id: true } });
    if (!photo) throw new NotFoundException('PDI voice upload not found.');
    return this.media.complete(clientId, photo.id);
  }
  async acceptPdi(clientId: string, userId: string, allocationId: string, items: Array<{ code: string; accepted: boolean; remarksText?: string; voiceMediaId?: string }>) {
    await this.assertRiderAllocation(clientId, userId, allocationId);
    const { workflow } = await this.workflow(clientId, allocationId);
    if (workflow.status !== MobileDeploymentStatus.PDI_PENDING_RIDER) throw new BadRequestException('PDI is not awaiting Rider acceptance.');
    const checklist = Array.isArray(workflow.pdiChecklist) ? workflow.pdiChecklist as Array<{ code: string; mandatory: boolean }> : [];
    if (!checklist.length) throw new BadRequestException('PDI checklist is unavailable.');
    for (const item of checklist) {
      const response = items.find((candidate) => candidate.code === item.code);
      if (!response) throw new BadRequestException(`PDI item ${item.code} has not been acknowledged.`);
      if (!response.accepted && !response.remarksText && !response.voiceMediaId) throw new BadRequestException(`A text or voice remark is required for rejected PDI item ${item.code}.`);
    }
    const voiceMediaIds = [...new Set(items.flatMap((item) => item.voiceMediaId ? [item.voiceMediaId] : []))];
    if (voiceMediaIds.length) {
      const evidence = await this.allocationEvidence(clientId, allocationId);
      const voiceNotes = await this.prisma.photo.count({ where: { id: { in: voiceMediaIds }, clientId, entityType: PhotoEntityType.INSPECTION, entityId: evidence.inspection.id, photoType: { startsWith: 'PDI_VOICE_' }, status: PhotoStatus.COMPLETE } });
      if (voiceNotes !== voiceMediaIds.length) throw new BadRequestException('Each PDI voice remark must be a completed voice upload for this allocation.');
    }
    const policy = await this.trainingPolicy(clientId);
    const acceptance = { riderPdiAcceptedAt: new Date(), riderPdiRemarksText: JSON.stringify(items), riderPdiVoicePhotoId: items.find((item) => item.voiceMediaId)?.voiceMediaId, pdiChecklist: items as never };
    if (policy.included) return this.prisma.mobileDeploymentWorkflow.update({ where: { id: workflow.id }, data: { ...acceptance, status: MobileDeploymentStatus.TRAINING_PENDING } });
    const deployed = await this.prisma.$transaction(tx => this.completeDeployment(tx, clientId, allocationId, workflow.id, acceptance));
    await this.referralAllocated(clientId, allocationId);
    return deployed;
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
    return this.prisma.mobileDeploymentWorkflow.update({ where: { id: workflow.id }, data: { trainingViewedContentCodes: nextViewed } });
  }
  async completeTraining(clientId: string, userId: string, allocationId: string) {
    await this.assertRiderAllocation(clientId, userId, allocationId);
    const { workflow } = await this.workflow(clientId, allocationId);
    if (workflow.status === MobileDeploymentStatus.DEPLOYED) return workflow;
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
    return deployed;
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
