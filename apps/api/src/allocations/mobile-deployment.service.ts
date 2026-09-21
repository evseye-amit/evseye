import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AllocationStatus, ClientSubscriptionStatus, DeploymentPaymentStatus, FleetStatus, InspectionStatus, InspectionType, MobileDeploymentStatus, PhotoEntityType, PhotoStatus, Prisma, RiderStatus } from '@prisma/client';
import { STORAGE_PROVIDER, type StorageProvider } from '../media/storage/storage-provider.interface.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AllocationsService } from './allocations.service.js';
import { MediaService } from '../media/media.service.js';
import type { CreateUploadIntentDto } from '../media/dto/create-upload-intent.dto.js';

@Injectable()
export class MobileDeploymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly allocations: AllocationsService,
    private readonly media: MediaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  private async trainingContents(clientId: string) {
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
    return subscription.package.features.flatMap((packageFeature) => packageFeature.feature.trainingContents);
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
    const hubs = await this.prisma.userHub.findMany({ where: { clientId, userId }, select: { hubId: true } });
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
  async pendingRiders(clientId: string, userId: string) {
    const hubIds = await this.fleetManagerHubIds(clientId, userId);
    if (!hubIds.length) return [];
    return this.prisma.rider.findMany({
      where: {
        clientId,
        status: RiderStatus.ACTIVE,
        deletedAt: null,
        allocations: { none: { status: { in: [AllocationStatus.INITIATED, AllocationStatus.INSPECTION_PENDING, AllocationStatus.OTP_PENDING, AllocationStatus.ACTIVE, AllocationStatus.DEALLOCATION_INITIATED] } } },
      },
      select: { id: true, riderCode: true, name: true, mobile: true, joiningDate: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }
  async eligibleFleets(clientId: string, userId: string) {
    const hubIds = await this.fleetManagerHubIds(clientId, userId);
    if (!hubIds.length) return [];
    return this.prisma.fleet.findMany({
      where: { clientId, currentHubId: { in: hubIds }, status: FleetStatus.AVAILABLE, onboardingStatus: 'ACTIVE', allocationEnabled: true, deletedAt: null },
      select: { id: true, fleetCode: true, vehicleNumber: true, chassisNumber: true, currentHub: { select: { id: true, code: true, name: true } }, iotDevice: { select: { id: true, deviceNumber: true, lastHeartbeatAt: true } } },
      orderBy: { fleetCode: 'asc' },
    });
  }
  async allocateFleet(clientId: string, userId: string, riderId: string, fleetId: string) {
    const hubIds = await this.fleetManagerHubIds(clientId, userId);
    const fleet = await this.prisma.fleet.findFirst({ where: { id: fleetId, clientId, currentHubId: { in: hubIds }, status: FleetStatus.AVAILABLE, onboardingStatus: 'ACTIVE', allocationEnabled: true, deletedAt: null }, select: { id: true } });
    if (!fleet) throw new NotFoundException('An allocatable Fleet was not found in your assigned Hubs.');
    const rider = await this.prisma.rider.findFirst({ where: { id: riderId, clientId, status: RiderStatus.ACTIVE, deletedAt: null, allocations: { none: { status: { in: [AllocationStatus.INITIATED, AllocationStatus.INSPECTION_PENDING, AllocationStatus.OTP_PENDING, AllocationStatus.ACTIVE, AllocationStatus.DEALLOCATION_INITIATED] } } } }, select: { id: true } });
    if (!rider) throw new BadRequestException('This Rider is not awaiting Fleet allocation.');
    return this.allocations.initiate(clientId, fleetId, riderId, userId);
  }
  async fleetRequests(clientId: string, userId: string) {
    const hubIds = (await this.prisma.userHub.findMany({ where: { clientId, userId }, select: { hubId: true } })).map((entry) => entry.hubId);
    return this.prisma.allocation.findMany({ where: { clientId, fleet: { currentHubId: { in: hubIds } }, mobileDeployment: { is: { status: { in: ['RIDER_WAITING', 'FLEET_REQUESTED', 'PAYMENT_PENDING', 'PAYMENT_PAID', 'PDI_PENDING_RIDER', 'TRAINING_PENDING', 'DEVICE_PAIRING_PENDING'] } } } }, include: { rider: true, fleet: { include: { iotDevice: true, photos: { where: { status: 'COMPLETE' } } } }, mobileDeployment: true } });
  }
  async riderCurrent(clientId: string, userId: string) {
    const rider = await this.prisma.rider.findFirst({ where: { clientId, userId, deletedAt: null }, select: { id: true } });
    if (!rider) return { screen: 'ONBOARDING' };
    const allocation = await this.prisma.allocation.findFirst({ where: { clientId, riderId: rider.id, mobileDeployment: { isNot: null } }, orderBy: { updatedAt: 'desc' }, include: { fleet: true, mobileDeployment: true } });
    if (!allocation?.mobileDeployment) return { screen: 'WAITING' };
    const status = allocation.mobileDeployment.status;
    const screen = ({ PAYMENT_PENDING: 'PAYMENT', PDI_PENDING_RIDER: 'PDI', TRAINING_PENDING: 'TRAINING', DEVICE_PAIRING_PENDING: 'DEVICE_PAIRING', DEPLOYED: 'HOME' } as Record<string, string>)[status] ?? 'WAITING';
    const payment = await this.prisma.deploymentPayment.findUnique({ where: { workflowId: allocation.mobileDeployment.id } });
    return { screen, allocation, workflow: allocation.mobileDeployment, payment };
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
    const device = allocation.fleet.iotDevice;
    if (!device) throw new BadRequestException('An IoT device must be mapped before fleet deployment.');
    if (!device.lastHeartbeatAt || Date.now() - device.lastHeartbeatAt.getTime() > 15 * 60 * 1000) throw new BadRequestException('IoT heartbeat is unavailable or stale.');
    return this.prisma.mobileDeploymentWorkflow.update({ where: { id: workflow.id }, data: { status: MobileDeploymentStatus.FLEET_REQUESTED } });
  }
  async askPayment(clientId: string, userId: string, allocationId: string, request: { currency: string; items: Array<{ label: string; amount: string }> }) {
    await this.assertFleetManagerHub(clientId, userId, allocationId);
    const { workflow } = await this.workflow(clientId, allocationId);
    if (workflow.status !== MobileDeploymentStatus.FLEET_REQUESTED) throw new BadRequestException('Fleet must be requested before asking for payment.');
    const amount = request.items.reduce((total, item) => total.plus(new Prisma.Decimal(item.amount)), new Prisma.Decimal(0));
    if (amount.lte(0)) throw new BadRequestException('Payment amount must be greater than zero.');
    const breakdown = { items: request.items, total: amount.toFixed(2) };
    return this.prisma.$transaction(async (tx) => {
      const advanced = await tx.mobileDeploymentWorkflow.updateMany({ where: { id: workflow.id, status: MobileDeploymentStatus.FLEET_REQUESTED }, data: { status: MobileDeploymentStatus.PAYMENT_PENDING, paymentBreakdown: breakdown as never } });
      if (advanced.count !== 1) throw new BadRequestException('Fleet deployment state changed. Refresh and try again.');
      return tx.deploymentPayment.create({ data: { clientId, workflowId: workflow.id, currency: request.currency.toUpperCase(), amount, breakdown: breakdown as never } });
    });
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
    const { workflow } = await this.workflow(clientId, allocationId);
    if (workflow.status !== MobileDeploymentStatus.PAYMENT_PENDING) throw new BadRequestException('No payment is pending.');
    const payment = await this.prisma.deploymentPayment.findUnique({ where: { workflowId: workflow.id } });
    if (!payment || payment.status !== DeploymentPaymentStatus.SUBMITTED) throw new BadRequestException('A Rider payment reference must be submitted before verification.');
    const paidAt = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.deploymentPayment.update({ where: { id: payment.id }, data: { status: DeploymentPaymentStatus.PAID, verifiedAt: paidAt, verifiedById: userId, paidAt } });
      return tx.mobileDeploymentWorkflow.update({ where: { id: workflow.id }, data: { status: MobileDeploymentStatus.PAYMENT_PAID, paymentPaidAt: paidAt } });
    });
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
    return this.prisma.mobileDeploymentWorkflow.update({ where: { id: workflow.id }, data: { status: MobileDeploymentStatus.TRAINING_PENDING, riderPdiAcceptedAt: new Date(), riderPdiRemarksText: JSON.stringify(items), riderPdiVoicePhotoId: items.find((item) => item.voiceMediaId)?.voiceMediaId, pdiChecklist: items as never } });
  }
  async training(clientId: string, userId: string, allocationId: string) {
    await this.assertRiderAllocation(clientId, userId, allocationId);
    const { workflow } = await this.workflow(clientId, allocationId);
    if (workflow.status !== MobileDeploymentStatus.TRAINING_PENDING) throw new BadRequestException('Training is not pending.');
    const viewed = Array.isArray(workflow.trainingViewedContentCodes) ? workflow.trainingViewedContentCodes.map(String) : [];
    const contents = await this.trainingContents(clientId);
    return Promise.all(contents.map(async (content) => ({
      code: content.code,
      title: content.title,
      description: content.description,
      isMandatory: content.isMandatory,
      displayOrder: content.displayOrder,
      viewed: viewed.includes(content.code),
      downloadUrl: await this.storage.createDownloadUrl(content.imageObjectKey),
    })));
  }
  async markTrainingViewed(clientId: string, userId: string, allocationId: string, contentCode: string) {
    await this.assertRiderAllocation(clientId, userId, allocationId);
    const { workflow } = await this.workflow(clientId, allocationId);
    if (workflow.status !== MobileDeploymentStatus.TRAINING_PENDING) throw new BadRequestException('Training is not pending.');
    const contents = await this.trainingContents(clientId);
    if (!contents.some((content) => content.code === contentCode)) throw new BadRequestException('Training content is not available in the active package.');
    const viewed = Array.isArray(workflow.trainingViewedContentCodes) ? workflow.trainingViewedContentCodes.map(String) : [];
    const nextViewed = [...new Set([...viewed, contentCode])];
    return this.prisma.mobileDeploymentWorkflow.update({ where: { id: workflow.id }, data: { trainingViewedContentCodes: nextViewed } });
  }
  async completeTraining(clientId: string, userId: string, allocationId: string) {
    await this.assertRiderAllocation(clientId, userId, allocationId);
    const { workflow } = await this.workflow(clientId, allocationId);
    if (workflow.status !== MobileDeploymentStatus.TRAINING_PENDING) throw new BadRequestException('Training is not pending.');
    const contents = await this.trainingContents(clientId);
    const mandatory = contents.filter((content) => content.isMandatory).map((content) => content.code);
    if (!mandatory.length) throw new BadRequestException('Mandatory Rider training has not been configured for the active package.');
    const viewed = Array.isArray(workflow.trainingViewedContentCodes) ? workflow.trainingViewedContentCodes.map(String) : [];
    const missing = mandatory.filter((code) => !viewed.includes(code));
    if (missing.length) throw new BadRequestException(`Complete mandatory training content first: ${missing.join(', ')}.`);
    return this.prisma.mobileDeploymentWorkflow.update({ where: { id: workflow.id }, data: { status: MobileDeploymentStatus.DEVICE_PAIRING_PENDING, trainingCompletedAt: new Date() } });
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
    const allocation = await tx.allocation.findFirst({
      where: { id: allocationId, clientId, status: AllocationStatus.OTP_PENDING },
      select: { fleetId: true },
    });
    if (!allocation) throw new BadRequestException('The allocation is not ready for deployment. Complete PDI first.');

    const fleet = await tx.fleet.updateMany({
      where: { id: allocation.fleetId, clientId, status: FleetStatus.RESERVED, deletedAt: null },
      data: { status: FleetStatus.ALLOCATED },
    });
    if (fleet.count !== 1) throw new BadRequestException('The selected Fleet is no longer reserved for this deployment.');

    const activated = await tx.allocation.updateMany({
      where: { id: allocationId, clientId, status: AllocationStatus.OTP_PENDING },
      data: { status: AllocationStatus.ACTIVE, allocatedAt: new Date() },
    });
    if (activated.count !== 1) throw new BadRequestException('The allocation status changed. Refresh and try again.');

    return tx.mobileDeploymentWorkflow.update({
      where: { id: workflowId },
      data: { ...workflowData, status: MobileDeploymentStatus.DEPLOYED },
    });
  }
  async pair(clientId: string, userId: string, allocationId: string, deviceNumber: string) {
    await this.assertRiderAllocation(clientId, userId, allocationId);
    const { workflow, allocation } = await this.workflow(clientId, allocationId);
    if (workflow.status !== MobileDeploymentStatus.DEVICE_PAIRING_PENDING) throw new BadRequestException('Device pairing is not pending.');
    if (!allocation.fleet.iotDevice || allocation.fleet.iotDevice.deviceNumber !== deviceNumber.trim()) throw new BadRequestException('The paired device does not match the Fleet IoT device.');
    return this.prisma.$transaction((tx) => this.completeDeployment(tx, clientId, allocationId, workflow.id, { pairedAt: new Date() }));
  }
  async bypassPairing(clientId: string, userId: string, allocationId: string, remarks: string) {
    await this.assertFleetManagerHub(clientId, userId, allocationId);
    const { workflow } = await this.workflow(clientId, allocationId);
    if (workflow.status !== MobileDeploymentStatus.DEVICE_PAIRING_PENDING) throw new BadRequestException('Device pairing is not pending.');
    if (!remarks.trim()) throw new BadRequestException('A bypass reason is required.');
    const health = await this.iotHealth(clientId, userId, allocationId);
    return this.prisma.$transaction((tx) => this.completeDeployment(tx, clientId, allocationId, workflow.id, {
      pairingBypassedAt: new Date(),
      pairingBypassedById: userId,
      pairingBypassReason: remarks.trim(),
      pairingHealthSnapshot: health as never,
    }));
  }
}
