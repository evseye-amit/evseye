import { isPaymentPhoto } from './payment-photo.js';
import { fleetManagerVisibleSubjects } from '../rider-access/rider-hub-policy.js';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PhotoEntityType, PhotoStatus, PhotoSubjectType, PhotoType, PhotoWorkflowType, Prisma, UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateUploadIntentDto } from './dto/create-upload-intent.dto.js';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from './storage/storage-provider.interface.js';

const legacyWorkflow = (ownerType: PhotoEntityType): PhotoWorkflowType => {
  if (([PhotoEntityType.FLEET, PhotoEntityType.BATTERY, PhotoEntityType.CONTROLLER, PhotoEntityType.IOT_DEVICE] as PhotoEntityType[]).includes(ownerType)) return PhotoWorkflowType.FLEET_MANAGEMENT;
  if (ownerType === PhotoEntityType.PREPARATION) return PhotoWorkflowType.PREPARATION;
  if (ownerType === PhotoEntityType.INSPECTION) return PhotoWorkflowType.ALLOTMENT;
  if (ownerType === PhotoEntityType.RIDER) return PhotoWorkflowType.RIDER_MANAGEMENT;
  if (ownerType === PhotoEntityType.RIDER_ONBOARDING) return PhotoWorkflowType.RIDER_ONBOARDING;
  if (ownerType === PhotoEntityType.SUPPORT_TICKET) return PhotoWorkflowType.SUPPORT;
  return PhotoWorkflowType.PAYMENT;
};

const legacySubject = (ownerType: PhotoEntityType): PhotoSubjectType => (ownerType === PhotoEntityType.RIDER ? PhotoSubjectType.PROFILE : ownerType === PhotoEntityType.RIDER_ONBOARDING ? PhotoSubjectType.RIDER_DOCUMENT : ownerType === PhotoEntityType.INSPECTION ? PhotoSubjectType.INSPECTION : ownerType === PhotoEntityType.PREPARATION ? PhotoSubjectType.PREPARATION : ownerType.startsWith('PAYMENT_') ? ownerType.slice('PAYMENT_'.length) as PhotoSubjectType : ownerType as unknown as PhotoSubjectType);

const workflowSubjects: Record<PhotoWorkflowType, PhotoSubjectType[]> = {
  FLEET_MANAGEMENT: [PhotoSubjectType.FLEET, PhotoSubjectType.BATTERY, PhotoSubjectType.CONTROLLER, PhotoSubjectType.IOT_DEVICE],
  PREPARATION: [PhotoSubjectType.PREPARATION, PhotoSubjectType.INSTALLATION],
  ALLOTMENT: [PhotoSubjectType.INSPECTION],
  SUBMISSION: [PhotoSubjectType.INSPECTION],
  RIDER_MANAGEMENT: [PhotoSubjectType.PROFILE],
  RIDER_ONBOARDING: [PhotoSubjectType.RIDER_DOCUMENT, PhotoSubjectType.PAN, PhotoSubjectType.AADHAR],
  SUPPORT: [PhotoSubjectType.SUPPORT_TICKET],
  PAYMENT: [PhotoSubjectType.ONBOARDING_FEES, PhotoSubjectType.DEPLOYMENT, PhotoSubjectType.COLLECTION, PhotoSubjectType.AUTOPAY, PhotoSubjectType.RECEIVED],
};

const assertWorkflowSubject = (workflow: PhotoWorkflowType, subject: PhotoSubjectType) => {
  if (!workflowSubjects[workflow].includes(subject)) throw new BadRequestException('Subject type is not supported by this workflow.');
};

const ownerFromWorkflow = (workflow: PhotoWorkflowType, subjectType: PhotoSubjectType | string): PhotoEntityType => {
  if (workflow === PhotoWorkflowType.PREPARATION) return PhotoEntityType.PREPARATION;
  if (workflow === PhotoWorkflowType.ALLOTMENT || workflow === PhotoWorkflowType.SUBMISSION) return PhotoEntityType.INSPECTION;
  if (workflow === PhotoWorkflowType.RIDER_MANAGEMENT) return PhotoEntityType.RIDER;
  if (workflow === PhotoWorkflowType.RIDER_ONBOARDING) return PhotoEntityType.RIDER_ONBOARDING;
  if (workflow === PhotoWorkflowType.SUPPORT) return PhotoEntityType.SUPPORT_TICKET;
  if (workflow === PhotoWorkflowType.PAYMENT) {
    const owner = `PAYMENT_${subjectType}` as PhotoEntityType;
    if (isPaymentPhoto(owner)) return owner;
  }
  if (workflow === PhotoWorkflowType.FLEET_MANAGEMENT) {
    const owner = subjectType as PhotoEntityType;
    if (([PhotoEntityType.FLEET, PhotoEntityType.BATTERY, PhotoEntityType.CONTROLLER, PhotoEntityType.IOT_DEVICE] as PhotoEntityType[]).includes(owner)) return owner;
  }
  throw new BadRequestException('Unsupported workflow and subject type combination.');
};

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async createUploadIntent(
    clientId: string,
    uploadedById: string,
    dto: CreateUploadIntentDto,
  ) {
    const workFlowType = dto.workFlowType ?? (dto.entityType ? legacyWorkflow(dto.entityType) : null);
    const subjectType = dto.subjectType ?? (dto.entityType ? legacySubject(dto.entityType) : null);
    if (!workFlowType || !subjectType) throw new BadRequestException('Workflow and subject types are required.');
    const ownerType = dto.entityType ?? ownerFromWorkflow(workFlowType, subjectType);
    assertWorkflowSubject(workFlowType, subjectType);
    if (isPaymentPhoto(ownerType)) throw new ForbiddenException('Payment receipts use the payment transaction routes.');
    if (ownerType === PhotoEntityType.SUPPORT_TICKET)
      throw new ForbiddenException(
        'Support attachments use the support ticket routes.',
      );
    return this.createUploadIntentForEntity(
      clientId,
      uploadedById,
      workFlowType,
      subjectType,
      ownerType,
      dto.entityId,
      dto.photoType,
      dto,
    );
  }

  async createSupportUploadIntent(
    clientId: string,
    uploadedById: string,
    ticketId: string,
    dto: Omit<CreateUploadIntentDto, 'entityType' | 'workFlowType' | 'subjectType' | 'entityId'>,
  ) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id: ticketId, clientId },
      select: { id: true },
    });
    if (!ticket) throw new NotFoundException('Support ticket not found.');
    return this.createUploadIntentForEntity(
      clientId,
      uploadedById,
      PhotoWorkflowType.SUPPORT,
      'SUPPORT_TICKET',
      PhotoEntityType.SUPPORT_TICKET,
      ticketId,
      dto.photoType,
      dto,
    );
  }

  async createPaymentUploadIntent(clientId: string, actorId: string, entityType: PhotoEntityType, entityId: string,
    dto: Omit<CreateUploadIntentDto, 'entityType' | 'entityId' | 'photoType' | 'workFlowType' | 'subjectType'>) {
    if (!isPaymentPhoto(entityType)) throw new BadRequestException('Invalid payment media entity.');
    return this.createUploadIntentForEntity(clientId, actorId, PhotoWorkflowType.PAYMENT, entityType.slice('PAYMENT_'.length) as PhotoSubjectType, entityType, entityId, PhotoType.RECEIPT, { ...dto, photoType: PhotoType.RECEIPT });
  }

  async completePayment(clientId: string, entityType: PhotoEntityType, entityId: string, photoId: string, uploaderId: string, db: Prisma.TransactionClient = this.prisma) {
    const photo = await db.photo.findFirst({ where: { id: photoId, clientId } });
    if (!photo) throw new NotFoundException('Payment receipt not found.');
    if (!isPaymentPhoto(entityType) || photo.entityType !== entityType || photo.entityId !== entityId || photo.uploadedById !== uploaderId)
      throw new NotFoundException('Payment receipt not found.');
    if (photo.status === PhotoStatus.COMPLETE) return photo;
    if (photo.status !== PhotoStatus.PENDING_UPLOAD) throw new BadRequestException('Receipt is not awaiting upload.');
    const sealed = `clients/${clientId}/payment-receipts/${entityId}/${randomUUID()}.${this.extensionFor(photo.mimeType)}`;
    await this.storage.assertObjectExists(photo.objectKey, { maxBytes: photo.sizeBytes });
    await this.storage.sealObject(photo.objectKey, sealed);
    await this.storage.assertObjectExists(sealed, { maxBytes: photo.sizeBytes });
    await db.photo.updateMany({ where: { id: photo.id, clientId, status: PhotoStatus.PENDING_UPLOAD },
      data: { objectKey: sealed, status: PhotoStatus.COMPLETE, uploadedAt: new Date() } });
    return db.photo.findFirstOrThrow({ where: { id: photo.id, clientId } });
  }

  async paymentDownloadUrl(clientId: string, entityType: PhotoEntityType, entityId: string, photoId: string) {
    const photo = await this.getPhoto(clientId, photoId);
    if (!isPaymentPhoto(entityType) || photo.entityType !== entityType || photo.entityId !== entityId)
      throw new NotFoundException('Payment receipt not found.');
    return this.downloadPhoto(photo);
  }

  async paymentContent(clientId: string, entityType: PhotoEntityType, entityId: string, photoId: string) {
    const photo = await this.getPhoto(clientId, photoId);
    if (!isPaymentPhoto(entityType) || photo.entityType !== entityType || photo.entityId !== entityId)
      throw new NotFoundException('Payment receipt not found.');
    if (photo.status !== PhotoStatus.COMPLETE) throw new BadRequestException('Receipt image is not available.');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(photo.mimeType) || photo.sizeBytes < 1 || photo.sizeBytes > 5 * 1024 * 1024)
      throw new BadRequestException('Receipt image has an unsupported type or size.');
    const bytes = await this.storage.readObject(photo.objectKey, photo.sizeBytes);
    return { bytes, mimeType: photo.mimeType, filename: `payment-receipt-${photo.id}.${this.extensionFor(photo.mimeType)}` };
  }

  private async createUploadIntentForEntity(
    clientId: string,
    uploadedById: string,
    workFlowType: PhotoWorkflowType,
    subjectType: PhotoSubjectType,
    entityType: PhotoEntityType,
    entityId: string,
    photoType: PhotoType,
    dto: Omit<CreateUploadIntentDto, 'entityType' | 'workFlowType' | 'subjectType' | 'entityId'>,
  ) {
    await this.assertEntityOwnership(clientId, entityType, entityId);
    assertWorkflowSubject(workFlowType, subjectType);
    const configured = await this.prisma.photoRequirement.findMany({
      where: { clientId, workFlowType, subjectType },
      select: { photoType: true },
    });
    const requirementType = photoType;
    if (configured.length && !configured.some((requirement) => requirement.photoType === requirementType)) {
      throw new BadRequestException('Photo type is not configured for this workflow and subject.');
    }
    this.assertExtensionMatchesMime(dto.fileName, dto.mimeType);

    const objectKey = `clients/${clientId}/${workFlowType.toLowerCase()}/${entityId}/${randomUUID()}.${this.extensionFor(dto.mimeType)}`;
    const photo = await this.prisma.photo.create({
      data: {
        clientId,
        workFlowType,
        subjectType,
        entityType,
        entityId,
        photoType,
        objectKey,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        uploadedById,
      },
    });
    const uploadUrl = await this.storage.createUploadUrl({
      objectKey,
      mimeType: dto.mimeType,
      sizeBytes: dto.sizeBytes,
    });

    return { photo, uploadUrl };
  }

  private async fleetEvidenceScope(clientId: string, fleetId: string) {
    const fleet = await this.prisma.fleet.findFirst({
      where: { id: fleetId, clientId, deletedAt: null },
      include: {
        batteryHistory: { where: { removedAt: null, battery: { clientId } }, select: { batteryId: true, installedAt: true, battery: { select: { serialNumber: true } } }, orderBy: { installedAt: 'asc' } },
        controllerHistory: { where: { removedAt: null, controller: { clientId } }, select: { controllerId: true, installedAt: true, controller: { select: { controllerNumber: true } } }, orderBy: { installedAt: 'asc' } },
        iotDevice: { select: { id: true, clientId: true } },
      },
    });
    if (!fleet) throw new NotFoundException('Fleet not found.');
    const [inspections, preparations] = await Promise.all([
      this.prisma.inspection.findMany({
        where: { clientId, allocation: { clientId, fleetId } },
        select: { id: true, type: true, createdAt: true, allocationId: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.fleetPreparation.findMany({
        where: { clientId, fleetId },
        include: { revisions: { where: { clientId } }, stages: { where: { clientId } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    type Group = {
      id: string;
      category: string;
      label: string;
      date: Date | null;
      workFlowType: PhotoWorkflowType;
      subjectType: PhotoSubjectType;
      entityType: PhotoEntityType;
      entityId: string;
      prefix?: boolean;
    };
    const groups: Group[] = [
      {
        id: fleetId,
        category: 'Fleet & components',
        label: 'Fleet onboarding',
        date: null,
        workFlowType: PhotoWorkflowType.FLEET_MANAGEMENT,
        subjectType: PhotoSubjectType.FLEET,
        entityType: PhotoEntityType.FLEET,
        entityId: fleetId,
      },
    ];
    for (const entry of fleet.batteryHistory)
      groups.push({
        id: `battery:${entry.batteryId}`,
        category: 'Fleet & components',
        label: `Battery · ${entry.battery.serialNumber}`,
        date: entry.installedAt,
        workFlowType: PhotoWorkflowType.FLEET_MANAGEMENT,
        subjectType: PhotoSubjectType.BATTERY,
        entityType: PhotoEntityType.BATTERY,
        entityId: entry.batteryId,
      });
    for (const entry of fleet.controllerHistory)
      groups.push({
        id: `controller:${entry.controllerId}`,
        category: 'Fleet & components',
        label: `Controller · ${entry.controller.controllerNumber}`,
        date: entry.installedAt,
        workFlowType: PhotoWorkflowType.FLEET_MANAGEMENT,
        subjectType: PhotoSubjectType.CONTROLLER,
        entityType: PhotoEntityType.CONTROLLER,
        entityId: entry.controllerId,
      });
    if (fleet.iotDevice?.clientId === clientId)
      groups.push({
        id: `iot:${fleet.iotDevice.id}`,
        category: 'Fleet & components',
        label: 'IoT installation',
        date: null,
        workFlowType: PhotoWorkflowType.FLEET_MANAGEMENT,
        subjectType: PhotoSubjectType.IOT_DEVICE,
        entityType: PhotoEntityType.IOT_DEVICE,
        entityId: fleet.iotDevice.id,
      });
    for (const inspection of inspections)
      groups.push({
        id: inspection.id,
        category:
          inspection.type === 'PRE_ALLOCATION' ? 'Allocation' : 'Submission',
        label: `${inspection.type === 'PRE_ALLOCATION' ? 'Allocation' : 'Submission'} · ${inspection.allocationId}`,
        date: inspection.createdAt,
        workFlowType: inspection.type === 'PRE_ALLOCATION' ? PhotoWorkflowType.ALLOTMENT : PhotoWorkflowType.SUBMISSION,
        subjectType: PhotoSubjectType.INSPECTION,
        entityType: PhotoEntityType.INSPECTION,
        entityId: inspection.id,
      });
    for (const preparation of preparations) {
      for (const revision of preparation.revisions)
        groups.push({
          id: revision.id,
          category: 'Preparation & QC',
          label: `Preparation ${preparation.id} · revision ${revision.revision}`,
          date: revision.createdAt,
          workFlowType: PhotoWorkflowType.PREPARATION,
          subjectType: PhotoSubjectType.PREPARATION,
          entityType: PhotoEntityType.PREPARATION,
          entityId: revision.id,
        });
      for (const stage of preparation.stages)
        groups.push({
          id: stage.id,
          category: 'Installation',
          label: `${stage.code} · ${preparation.id}`,
          date: preparation.createdAt,
          workFlowType: PhotoWorkflowType.PREPARATION,
          subjectType: PhotoSubjectType.INSTALLATION,
          entityType: PhotoEntityType.PREPARATION,
          entityId: `installation:${stage.id}:`,
          prefix: true,
        });
    }
    const unique = [
      ...new Map(groups.map((group) => [group.id, group])).values(),
    ];
    const where: Prisma.PhotoWhereInput = {
      clientId,
      status: PhotoStatus.COMPLETE,
      OR: unique.map((group) => ({
        workFlowType: group.workFlowType,
        subjectType: group.subjectType,
        entityType: group.entityType,
        entityId: group.prefix
          ? { startsWith: group.entityId }
          : group.entityId,
      })),
    };
    return { groups: unique, where };
  }

  async fleetEvidence(clientId: string, fleetId: string) {
    const { groups, where } = await this.fleetEvidenceScope(clientId, fleetId);
    const photos = await this.prisma.photo.findMany({
      where,
      select: {
        id: true,
        workFlowType: true,
        subjectType: true,
        entityType: true,
        entityId: true,
        photoType: true,
        mimeType: true,
        uploadedAt: true,
        createdAt: true,
      },
      orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
    });
    return groups.map((group) => ({
      id: group.id,
      category: group.category,
      label: group.label,
      date: group.date,
      photos: photos.filter(
        (photo) =>
          photo.entityType === group.entityType &&
          photo.workFlowType === group.workFlowType &&
          photo.subjectType === group.subjectType &&
          (group.prefix
            ? photo.entityId.startsWith(group.entityId)
            : photo.entityId === group.entityId),
      ),
    }));
  }

  async fleetEvidenceContent(
    clientId: string,
    fleetId: string,
    photoId: string,
  ) {
    const { where } = await this.fleetEvidenceScope(clientId, fleetId);
    const photo = await this.prisma.photo.findFirst({
      where: { ...where, id: photoId },
    });
    if (!photo) throw new NotFoundException('Fleet evidence photo not found.');
    if (
      !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(
        photo.mimeType,
      ) ||
      photo.sizeBytes < 1 ||
      photo.sizeBytes > 5 * 1024 * 1024
    )
      throw new BadRequestException('This evidence file cannot be previewed.');
    return {
      bytes: await this.storage.readObject(photo.objectKey, photo.sizeBytes),
      mimeType: photo.mimeType,
      filename: `fleet-evidence-${photo.id}.${photo.mimeType === 'application/pdf' ? 'pdf' : photo.mimeType.split('/')[1]}`,
    };
  }

  async requirements(clientId: string, workFlowType: PhotoWorkflowType | PhotoEntityType, subjectType?: string): Promise<Prisma.PhotoRequirementGetPayload<object>[]> {
    if (!subjectType && (Object.values(PhotoEntityType) as string[]).includes(workFlowType as string)) {
      const ownerType = workFlowType as PhotoEntityType;
      const resolvedWorkflow = legacyWorkflow(ownerType);
      const defaultSubject = legacySubject(ownerType);
      if (ownerType === PhotoEntityType.SUPPORT_TICKET) throw new ForbiddenException('Support attachments use the support ticket routes.');
      return this.requirements(clientId, resolvedWorkflow, subjectType ?? defaultSubject);
    }
    if (!subjectType) subjectType = workFlowType === PhotoWorkflowType.SUPPORT ? 'SUPPORT_TICKET' : workFlowType === PhotoWorkflowType.RIDER_ONBOARDING ? 'RIDER_DOCUMENT' : workFlowType === PhotoWorkflowType.RIDER_MANAGEMENT ? 'PROFILE' : workFlowType === PhotoWorkflowType.FLEET_MANAGEMENT ? 'FLEET' : 'INSPECTION';
    assertWorkflowSubject(workFlowType as PhotoWorkflowType, subjectType as PhotoSubjectType);
    if (workFlowType === PhotoWorkflowType.SUPPORT) throw new ForbiddenException('Support attachments use the support ticket routes.');
    const resolvedWorkflow = workFlowType as PhotoWorkflowType;
    return this.prisma.photoRequirement.findMany({
      where: { clientId, workFlowType: resolvedWorkflow, subjectType: subjectType as PhotoSubjectType },
      orderBy: [{ isRequired: 'desc' }, { photoType: 'asc' }],
    });
  }

  async requirementsLegacy(clientId: string, ownerType: PhotoEntityType) {
    if (ownerType === PhotoEntityType.SUPPORT_TICKET) throw new ForbiddenException('Support attachments use the support ticket routes.');
    const workFlowType = legacyWorkflow(ownerType) as PhotoWorkflowType;
    const subjectType = legacySubject(ownerType);
    return this.requirements(clientId, workFlowType, subjectType);
  }

  async listEntityPhotos(
    clientId: string,
    workFlowType: PhotoWorkflowType | PhotoEntityType,
    subjectTypeOrEntityId: string,
    entityIdOrActor?: string | AuthUser,
    maybeActor?: AuthUser,
  ): Promise<Prisma.PhotoGetPayload<object>[]> {
    if (typeof entityIdOrActor !== 'string' && (Object.values(PhotoEntityType) as string[]).includes(workFlowType as string)) {
      const ownerType = workFlowType as PhotoEntityType;
      const resolvedWorkflow = legacyWorkflow(ownerType) as PhotoWorkflowType;
      const subjectType = legacySubject(ownerType);
      const legacyActor = typeof entityIdOrActor === 'string' ? maybeActor : entityIdOrActor;
      return this.listEntityPhotos(clientId, resolvedWorkflow, subjectType, subjectTypeOrEntityId, legacyActor);
    }
    const subjectType = typeof entityIdOrActor === 'string' || entityIdOrActor === undefined
      ? subjectTypeOrEntityId
      : workFlowType === PhotoWorkflowType.FLEET_MANAGEMENT ? 'FLEET' : workFlowType === PhotoWorkflowType.RIDER_MANAGEMENT ? 'PROFILE' : workFlowType === PhotoWorkflowType.RIDER_ONBOARDING ? 'RIDER_DOCUMENT' : 'INSPECTION';
    const entityId = typeof entityIdOrActor === 'string' ? entityIdOrActor : subjectTypeOrEntityId;
    const actor = typeof entityIdOrActor === 'string' ? maybeActor : entityIdOrActor;
    const resolvedWorkflow = workFlowType as PhotoWorkflowType;
    const ownerType = ownerFromWorkflow(resolvedWorkflow, subjectType);
    if (isPaymentPhoto(ownerType)) throw new ForbiddenException('Payment receipts use the payment transaction routes.');
    if (ownerType === PhotoEntityType.SUPPORT_TICKET)
      throw new ForbiddenException(
        'Support attachments use the support ticket routes.',
      );
    await this.assertEntityOwnership(clientId, ownerType, entityId);
    await this.assertFleetManagerEntityAccess(
      clientId,
      actor,
      ownerType,
      entityId,
    );
    return this.prisma.photo.findMany({
      where: { clientId, workFlowType: workFlowType as PhotoWorkflowType, subjectType: subjectType as PhotoSubjectType, entityType: ownerType, entityId },
      orderBy: { uploadedAt: 'asc' },
    });
  }

  async listEntityPhotosLegacy(clientId: string, ownerType: PhotoEntityType, entityId: string, actor?: AuthUser) {
    const workFlowType = legacyWorkflow(ownerType);
    const subjectType = legacySubject(ownerType);
    return this.listEntityPhotos(clientId, workFlowType, subjectType, entityId, actor);
  }

  async upsertRequirement(
    clientId: string,
    workFlowType: PhotoWorkflowType | PhotoEntityType,
    subjectTypeOrPhotoType: string,
    photoTypeOrInput: string | { isRequired: boolean; sortOrder?: number; featureCode?: string },
    maybeInput?: { isRequired: boolean; sortOrder?: number; featureCode?: string },
  ): Promise<Prisma.PhotoRequirementGetPayload<object>> {
    if (typeof photoTypeOrInput !== 'string' && (Object.values(PhotoEntityType) as string[]).includes(workFlowType as string)) {
      const ownerType = workFlowType as PhotoEntityType;
      const resolvedWorkflow = legacyWorkflow(ownerType);
      const subjectType = legacySubject(ownerType);
      if (typeof photoTypeOrInput === 'string') return this.upsertRequirement(clientId, resolvedWorkflow, subjectType, subjectTypeOrPhotoType, maybeInput ?? { isRequired: true });
      return this.upsertRequirement(clientId, resolvedWorkflow, subjectType, subjectTypeOrPhotoType, photoTypeOrInput);
    }
    const resolvedWorkflow = workFlowType as PhotoWorkflowType;
    const subjectType = typeof photoTypeOrInput === 'string' ? subjectTypeOrPhotoType : resolvedWorkflow === PhotoWorkflowType.FLEET_MANAGEMENT ? 'FLEET' : resolvedWorkflow === PhotoWorkflowType.RIDER_MANAGEMENT ? 'PROFILE' : 'INSPECTION';
    const photoType = typeof photoTypeOrInput === 'string' ? photoTypeOrInput : subjectTypeOrPhotoType;
    const input = (typeof photoTypeOrInput === 'string' ? maybeInput : photoTypeOrInput)!;
    if (resolvedWorkflow === PhotoWorkflowType.SUPPORT) throw new ForbiddenException('Support attachments use the support ticket routes.');
    assertWorkflowSubject(resolvedWorkflow, subjectType as PhotoSubjectType);
    return this.prisma.photoRequirement.upsert({
      where: {
        clientId_workFlowType_subjectType_photoType: { clientId, workFlowType: resolvedWorkflow, subjectType: subjectType as PhotoSubjectType, photoType: photoType as PhotoType },
      },
      create: {
        clientId,
        workFlowType: resolvedWorkflow,
        subjectType: subjectType as PhotoSubjectType,
        photoType: photoType as PhotoType,
        featureCode: input.featureCode ?? null,
        isRequired: input.isRequired,
        sortOrder: input.sortOrder ?? 0,
      },
      update: {
        isRequired: input.isRequired,
        featureCode: input.featureCode ?? null,
        ...(input.sortOrder === undefined
          ? {}
          : { sortOrder: input.sortOrder }),
      },
    });
  }

  async upsertRequirementLegacy(clientId: string, ownerType: PhotoEntityType, photoType: string, input: { isRequired: boolean; sortOrder?: number; featureCode?: string }) {
    if (ownerType === PhotoEntityType.SUPPORT_TICKET) throw new ForbiddenException('Support attachments use the support ticket routes.');
    const workFlowType = legacyWorkflow(ownerType);
    const subjectType = legacySubject(ownerType);
    return this.upsertRequirement(clientId, workFlowType, subjectType, photoType, input);
  }

  async complete(clientId: string, photoId: string) {
    const photo = await this.getPhoto(clientId, photoId);
    if (isPaymentPhoto(photo.entityType)) throw new ForbiddenException('Payment receipts use the payment transaction routes.');
    if (photo.entityType === PhotoEntityType.PREPARATION)
      throw new ForbiddenException(
        'Preparation photos use the preparation routes.',
      );
    if (photo.entityType === PhotoEntityType.SUPPORT_TICKET)
      throw new ForbiddenException(
        'Support attachments use the support ticket routes.',
      );
    return this.completePhoto(clientId, photo);
  }

  async completeSupport(clientId: string, ticketId: string, photoId: string) {
    const photo = await this.getPhoto(clientId, photoId);
    if (
      photo.entityType !== PhotoEntityType.SUPPORT_TICKET ||
      photo.entityId !== ticketId
    )
      throw new NotFoundException('Support attachment not found.');
    return this.completePhoto(clientId, photo);
  }

  private async completePhoto(
    clientId: string,
    photo: Awaited<ReturnType<MediaService['getPhoto']>>,
  ) {
    if (photo.status !== PhotoStatus.PENDING_UPLOAD) {
      throw new BadRequestException('Photo is not awaiting upload completion.');
    }
    await this.storage.assertObjectExists(photo.objectKey);
    // A new upload for a completed slot is a replacement, rather than another
    // active image for the same fleet/component photo type. Keeping prior
    // objects as DELETED retains an audit trail without letting stale evidence
    // satisfy the onboarding requirement.
    return this.prisma.$transaction(async (tx) => {
      // Retain evidence referenced by imposed reports when a newer photo replaces a slot.
      // The inspection lock also serializes replacement against penalty imposition.
      if (photo.entityType === PhotoEntityType.INSPECTION)
        await tx.$queryRaw`SELECT id FROM "Inspection" WHERE id=${photo.entityId} AND "clientId"=${clientId} FOR UPDATE`;
      const reports =
        photo.entityType === PhotoEntityType.INSPECTION
          ? await tx.vehicleSubmissionReport.findMany({
              where: {
                clientId,
                status: { in: ['SUBMITTED', 'POSTED'] },
                submission: { inspectionId: photo.entityId },
              },
              select: { evidencePhotoIds: true, items: true },
            })
          : [];
      const protectedIds = [
        ...new Set(
          reports.flatMap((report) => [
            ...report.evidencePhotoIds,
            ...(Array.isArray(report.items)
              ? (report.items as { evidencePhotoIds?: string[] }[]).flatMap(
                  (item) => item.evidencePhotoIds ?? [],
                )
              : []),
          ]),
        ),
      ];
      await tx.photo.updateMany({
        where: {
          clientId,
          entityType: photo.entityType,
          entityId: photo.entityId,
          photoType: photo.photoType,
          status: PhotoStatus.COMPLETE,
          id: {
            not: photo.id,
            ...(protectedIds.length ? { notIn: protectedIds } : {}),
          },
        },
        data: { status: PhotoStatus.DELETED },
      });
      return tx.photo.update({
        where: { id: photo.id },
        data: { status: PhotoStatus.COMPLETE, uploadedAt: new Date() },
      });
    });
  }

  async downloadUrl(clientId: string, photoId: string, actor?: AuthUser) {
    const photo = await this.getPhoto(clientId, photoId);
    if (isPaymentPhoto(photo.entityType)) throw new ForbiddenException('Payment receipts use the payment transaction routes.');
    await this.assertFleetManagerPhotoAccess(clientId, actor, photo);
    if (photo.entityType === PhotoEntityType.PREPARATION)
      throw new ForbiddenException(
        'Preparation photos use the preparation routes.',
      );
    if (photo.entityType === PhotoEntityType.SUPPORT_TICKET)
      throw new ForbiddenException(
        'Support attachments use the support ticket routes.',
      );
    return this.downloadPhoto(photo);
  }

  async supportDownloadUrl(
    clientId: string,
    ticketId: string,
    photoId: string,
  ) {
    const photo = await this.getPhoto(clientId, photoId);
    if (
      photo.entityType !== PhotoEntityType.SUPPORT_TICKET ||
      photo.entityId !== ticketId
    )
      throw new NotFoundException('Support attachment not found.');
    return this.downloadPhoto(photo);
  }

  private async downloadPhoto(
    photo: Awaited<ReturnType<MediaService['getPhoto']>>,
  ) {
    if (photo.status !== PhotoStatus.COMPLETE) {
      throw new BadRequestException('Photo is not available.');
    }
    return { url: await this.storage.createDownloadUrl(photo.objectKey) };
  }

  private async getPhoto(clientId: string, photoId: string) {
    const photo = await this.prisma.photo.findFirst({
      where: { id: photoId, clientId },
    });
    if (!photo) {
      throw new NotFoundException('Photo not found.');
    }
    return photo;
  }

  private fleetScoped(actor?: AuthUser) {
    return Boolean(
      actor?.roles.includes(UserRole.FLEET_MANAGER) &&
      !actor.roles.some(
        (role) =>
          role === UserRole.CLIENT_ADMIN ||
          role === UserRole.FLEET_MANAGER ||
          role === UserRole.KYC_OPERATOR,
      ),
    );
  }

  private async assertFleetManagerEntityAccess(
    clientId: string,
    actor: AuthUser | undefined,
    entityType: PhotoEntityType,
    entityId: string,
  ) {
    if (!actor || !this.fleetScoped(actor)) return;
    if (
      entityType !== PhotoEntityType.RIDER &&
      entityType !== PhotoEntityType.RIDER_ONBOARDING
    )
      return;
    const visible = await fleetManagerVisibleSubjects(
      this.prisma,
      clientId,
      actor.id,
    );
    const allowed =
      entityType === PhotoEntityType.RIDER
        ? visible.riderIds.includes(entityId)
        : await this.visibleOnboardingProgress(
            clientId,
            entityId,
            visible.userIds,
          );
    if (!allowed) throw new NotFoundException('Media entity not found.');
  }

  private async visibleOnboardingProgress(
    clientId: string,
    progressId: string,
    userIds: string[],
  ) {
    if (!userIds.length) return false;
    return !!(await this.prisma.riderOnboardingProgress.findFirst({
      where: { id: progressId, clientId, userId: { in: userIds } },
      select: { id: true },
    }));
  }

  private async assertFleetManagerPhotoAccess(
    clientId: string,
    actor: AuthUser | undefined,
    photo: { entityType: PhotoEntityType; entityId: string; id: string },
  ) {
    if (!actor || !this.fleetScoped(actor)) return;
    if (photo.entityType === PhotoEntityType.INSPECTION) {
      const hubs = await this.prisma.userHub.findMany({
        where: {
          clientId,
          userId: actor.id,
          hub: { clientId, status: 'ACTIVE', deletedAt: null },
        },
        select: { hubId: true },
      });
      const inspection = await this.prisma.inspection.findFirst({
        where: {
          id: photo.entityId,
          clientId,
          allocation: {
            clientId,
            fleet: {
              clientId,
              deletedAt: null,
              currentHubId: { in: hubs.map((hub) => hub.hubId) },
            },
          },
        },
        select: { id: true },
      });
      if (!inspection) throw new NotFoundException('Photo not found.');
      return;
    }
    if (
      photo.entityType !== PhotoEntityType.RIDER &&
      photo.entityType !== PhotoEntityType.RIDER_ONBOARDING
    )
      throw new NotFoundException('Photo not found.');
    try {
      await this.assertFleetManagerEntityAccess(
        clientId,
        actor,
        photo.entityType,
        photo.entityId,
      );
    } catch (error) {
      if (error instanceof NotFoundException)
        throw new NotFoundException('Photo not found.');
      throw error;
    }
  }

  private async assertEntityOwnership(
    clientId: string,
    entityType: PhotoEntityType,
    entityId: string,
  ) {
    if (isPaymentPhoto(entityType)) {
      const where = { id: entityId, clientId };
      const row = entityType === PhotoEntityType.PAYMENT_DEPLOYMENT ? await this.prisma.deploymentPayment.findFirst({ where })
        : entityType === PhotoEntityType.PAYMENT_COLLECTION ? await this.prisma.paymentCollectionRequest.findFirst({ where })
        : entityType === PhotoEntityType.PAYMENT_AUTOPAY ? await this.prisma.paymentTransaction.findFirst({ where })
        : await this.prisma.riderPayment.findFirst({ where });
      if (row) return;
    }
    if (entityType === PhotoEntityType.RIDER) {
      const rider = await this.prisma.rider.findFirst({
        where: { id: entityId, clientId, deletedAt: null },
      });
      if (rider) return;
    }
    if (entityType === PhotoEntityType.RIDER_ONBOARDING) {
      const progress = await this.prisma.riderOnboardingProgress.findFirst({
        where: { id: entityId, clientId },
      });
      if (progress) return;
    }
    if (entityType === PhotoEntityType.FLEET) {
      const fleet = await this.prisma.fleet.findFirst({
        where: { id: entityId, clientId, deletedAt: null },
      });
      if (fleet) return;
    }
    if (entityType === PhotoEntityType.BATTERY) {
      const battery = await this.prisma.battery.findFirst({
        where: { id: entityId, clientId },
      });
      if (battery) return;
    }
    if (entityType === PhotoEntityType.CONTROLLER) {
      const controller = await this.prisma.controller.findFirst({
        where: { id: entityId, clientId },
      });
      if (controller) return;
    }
    if (entityType === PhotoEntityType.IOT_DEVICE) {
      const device = await this.prisma.ioTDevice.findFirst({
        where: { id: entityId, clientId },
      });
      if (device) return;
    }
    if (entityType === PhotoEntityType.INSPECTION) {
      const inspection = await this.prisma.inspection.findFirst({
        where: { id: entityId, clientId },
      });
      if (inspection) return;
    }
    if (entityType === PhotoEntityType.SUPPORT_TICKET) {
      const ticket = await this.prisma.supportTicket.findFirst({
        where: { id: entityId, clientId },
      });
      if (ticket) return;
    }
    throw new NotFoundException('Media entity not found.');
  }

  private assertExtensionMatchesMime(fileName: string, mimeType: string) {
    const extension = fileName.split('.').pop()?.toLowerCase();
    if (!extension || (extension !== this.extensionFor(mimeType) && !(mimeType === 'image/jpeg' && extension === 'jpeg'))) {
      throw new BadRequestException(
        'File extension does not match its MIME type.',
      );
    }
  }

  private extensionFor(mimeType: string): string {
    return (
      {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'application/pdf': 'pdf',
        'audio/mpeg': 'mp3',
        'audio/mp4': 'm4a',
        'audio/wav': 'wav',
        'audio/ogg': 'ogg',
      }[mimeType] ?? 'invalid'
    );
  }
}
