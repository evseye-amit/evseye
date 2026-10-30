import { fleetManagerVisibleSubjects } from '../rider-access/rider-hub-policy.js';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PhotoStatus, PhotoSubjectType, PhotoType, PhotoWorkflowType, Prisma, UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateUploadIntentDto } from './dto/create-upload-intent.dto.js';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from './storage/storage-provider.interface.js';

const paymentSubjects = { DEPLOYMENT: PhotoSubjectType.OTHER, COLLECTION: PhotoSubjectType.COLLECTION, AUTOPAY: PhotoSubjectType.AUTOPAY, RECEIVED: PhotoSubjectType.OTHER } as const;
type PaymentSource = keyof typeof paymentSubjects;
const paymentSubject = (source: PaymentSource) => paymentSubjects[source];
const isPaymentSubject = (workflow: PhotoWorkflowType, subject: PhotoSubjectType) => workflow === PhotoWorkflowType.PAYMENT && Object.values(paymentSubjects).includes(subject as typeof paymentSubjects[PaymentSource]);

const workflowSubjects: Record<PhotoWorkflowType, PhotoSubjectType[]> = {
  FLEET_INSPECTION: [PhotoSubjectType.FLEET, PhotoSubjectType.BATTERY, PhotoSubjectType.CONTROLLER, PhotoSubjectType.IOT_DEVICE, PhotoSubjectType.MOTOR, PhotoSubjectType.TYRE, PhotoSubjectType.DOCK],
  FLEET_PREPARATION: [PhotoSubjectType.FLEET, PhotoSubjectType.OTHER],
  FLEET_ALLOTMENT: [PhotoSubjectType.FLEET],
  FLEET_SUBMISSION: [PhotoSubjectType.FLEET],
  RIDER_ONBOARDING: [PhotoSubjectType.PROFILE, PhotoSubjectType.PAN, PhotoSubjectType.AADHAR, PhotoSubjectType.DRIVING_LICENSE, PhotoSubjectType.BANK, PhotoSubjectType.DECLARATION],
  SUPPORT: [PhotoSubjectType.SUPPORT_TICKET],
  PAYMENT: [PhotoSubjectType.ONBOARDING_FEES, PhotoSubjectType.OTHER, PhotoSubjectType.COLLECTION, PhotoSubjectType.AUTOPAY],
};

const assertWorkflowSubject = (workflow: PhotoWorkflowType, subject: PhotoSubjectType) => {
  if (!workflowSubjects[workflow].includes(subject)) throw new BadRequestException('Subject type is not supported by this workflow.');
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
    const workFlowType = dto.workFlowType;
    const subjectType = dto.subjectType;
    if (!workFlowType || !subjectType) throw new BadRequestException('Workflow and subject types are required.');
    assertWorkflowSubject(workFlowType, subjectType);
    if (isPaymentSubject(workFlowType, subjectType)) throw new ForbiddenException('Payment receipts use the payment transaction routes.');
    if (workFlowType === PhotoWorkflowType.SUPPORT)
      throw new ForbiddenException(
        'Support attachments use the support ticket routes.',
      );
    return this.createUploadIntentForEntity(
      clientId,
      uploadedById,
      workFlowType,
      subjectType,
      dto.entityId,
      dto.photoType,
      dto,
    );
  }

  async createSupportUploadIntent(
    clientId: string,
    uploadedById: string,
    ticketId: string,
    dto: Omit<CreateUploadIntentDto, 'workFlowType' | 'subjectType' | 'entityId'>,
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
      PhotoSubjectType.SUPPORT_TICKET,
      ticketId,
      dto.photoType,
      dto,
    );
  }

  async createPaymentUploadIntent(clientId: string, actorId: string, source: PaymentSource, entityId: string,
    dto: Omit<CreateUploadIntentDto, 'entityId' | 'photoType' | 'workFlowType' | 'subjectType'>) {
    return this.createUploadIntentForEntity(clientId, actorId, PhotoWorkflowType.PAYMENT, paymentSubject(source), entityId, PhotoType.RECEIPT, { ...dto, photoType: PhotoType.RECEIPT });
  }

  async completePayment(clientId: string, source: PaymentSource, entityId: string, photoId: string, uploaderId: string, db: Prisma.TransactionClient = this.prisma) {
    const photo = await db.photo.findFirst({ where: { id: photoId, clientId } });
    if (!photo) throw new NotFoundException('Payment receipt not found.');
    if (!isPaymentSubject(photo.workFlowType, photo.subjectType) || photo.subjectType !== paymentSubject(source) || photo.entityId !== entityId || photo.uploadedById !== uploaderId)
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

  async paymentDownloadUrl(clientId: string, source: PaymentSource, entityId: string, photoId: string) {
    const photo = await this.getPhoto(clientId, photoId);
    if (!isPaymentSubject(photo.workFlowType, photo.subjectType) || photo.subjectType !== paymentSubject(source) || photo.entityId !== entityId)
      throw new NotFoundException('Payment receipt not found.');
    return this.downloadPhoto(photo);
  }

  async paymentContent(clientId: string, source: PaymentSource, entityId: string, photoId: string) {
    const photo = await this.getPhoto(clientId, photoId);
    if (!isPaymentSubject(photo.workFlowType, photo.subjectType) || photo.subjectType !== paymentSubject(source) || photo.entityId !== entityId)
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
    entityId: string,
    photoType: PhotoType,
    dto: Omit<CreateUploadIntentDto, 'workFlowType' | 'subjectType' | 'entityId'>,
  ) {
    await this.assertEntityOwnership(clientId, workFlowType, subjectType, entityId);
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
      entityId: string;
      prefix?: boolean;
    };
    const groups: Group[] = [
      {
        id: fleetId,
        category: 'Fleet & components',
        label: 'Fleet onboarding',
        date: null,
        workFlowType: PhotoWorkflowType.FLEET_INSPECTION,
        subjectType: PhotoSubjectType.FLEET,
        entityId: fleetId,
      },
    ];
    for (const entry of fleet.batteryHistory)
      groups.push({
        id: `battery:${entry.batteryId}`,
        category: 'Fleet & components',
        label: `Battery · ${entry.battery.serialNumber}`,
        date: entry.installedAt,
        workFlowType: PhotoWorkflowType.FLEET_INSPECTION,
        subjectType: PhotoSubjectType.BATTERY,
        entityId: entry.batteryId,
      });
    for (const entry of fleet.controllerHistory)
      groups.push({
        id: `controller:${entry.controllerId}`,
        category: 'Fleet & components',
        label: `Controller · ${entry.controller.controllerNumber}`,
        date: entry.installedAt,
        workFlowType: PhotoWorkflowType.FLEET_INSPECTION,
        subjectType: PhotoSubjectType.CONTROLLER,
        entityId: entry.controllerId,
      });
    if (fleet.iotDevice?.clientId === clientId)
      groups.push({
        id: `iot:${fleet.iotDevice.id}`,
        category: 'Fleet & components',
        label: 'IoT installation',
        date: null,
        workFlowType: PhotoWorkflowType.FLEET_INSPECTION,
        subjectType: PhotoSubjectType.IOT_DEVICE,
        entityId: fleet.iotDevice.id,
      });
    for (const inspection of inspections)
      groups.push({
        id: inspection.id,
        category:
          inspection.type === 'PRE_ALLOCATION' ? 'Allocation' : 'Submission',
        label: `${inspection.type === 'PRE_ALLOCATION' ? 'Allocation' : 'Submission'} · ${inspection.allocationId}`,
        date: inspection.createdAt,
        workFlowType: inspection.type === 'PRE_ALLOCATION' ? PhotoWorkflowType.FLEET_ALLOTMENT : PhotoWorkflowType.FLEET_SUBMISSION,
        subjectType: PhotoSubjectType.FLEET,
        entityId: inspection.id,
      });
    for (const preparation of preparations) {
      for (const revision of preparation.revisions)
        groups.push({
          id: revision.id,
          category: 'Preparation & QC',
          label: `Preparation ${preparation.id} · revision ${revision.revision}`,
          date: revision.createdAt,
          workFlowType: PhotoWorkflowType.FLEET_PREPARATION,
          subjectType: PhotoSubjectType.FLEET,
          entityId: revision.id,
        });
      for (const stage of preparation.stages)
        groups.push({
          id: stage.id,
          category: 'Installation',
          label: `${stage.code} · ${preparation.id}`,
          date: preparation.createdAt,
          workFlowType: PhotoWorkflowType.FLEET_PREPARATION,
          subjectType: PhotoSubjectType.OTHER,
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

  async requirements(clientId: string, workFlowType: PhotoWorkflowType, subjectType: PhotoSubjectType): Promise<Prisma.PhotoRequirementGetPayload<object>[]> {
    assertWorkflowSubject(workFlowType, subjectType);
    if (workFlowType === PhotoWorkflowType.SUPPORT) throw new ForbiddenException('Support attachments use the support ticket routes.');
    return this.prisma.photoRequirement.findMany({ where: { clientId, workFlowType, subjectType }, orderBy: [{ isRequired: 'desc' }, { photoType: 'asc' }] });
  }

  async listEntityPhotos(clientId: string, workFlowType: PhotoWorkflowType, subjectType: PhotoSubjectType, entityId: string, actor?: AuthUser): Promise<Prisma.PhotoGetPayload<object>[]> {
    assertWorkflowSubject(workFlowType, subjectType);
    if (isPaymentSubject(workFlowType, subjectType)) throw new ForbiddenException('Payment receipts use the payment transaction routes.');
    if (workFlowType === PhotoWorkflowType.SUPPORT) throw new ForbiddenException('Support attachments use the support ticket routes.');
    await this.assertEntityOwnership(clientId, workFlowType, subjectType, entityId);
    await this.assertFleetManagerEntityAccess(clientId, actor, workFlowType, subjectType, entityId);
    return this.prisma.photo.findMany({ where: { clientId, workFlowType, subjectType, entityId }, orderBy: { uploadedAt: 'asc' } });
  }

  async upsertRequirement(clientId: string, workFlowType: PhotoWorkflowType, subjectType: PhotoSubjectType, photoType: PhotoType, input: { isRequired: boolean; sortOrder?: number; featureCode?: string }): Promise<Prisma.PhotoRequirementGetPayload<object>> {
    if (workFlowType === PhotoWorkflowType.SUPPORT) throw new ForbiddenException('Support attachments use the support ticket routes.');
    assertWorkflowSubject(workFlowType, subjectType);
    return this.prisma.photoRequirement.upsert({
      where: { clientId_workFlowType_subjectType_photoType: { clientId, workFlowType, subjectType, photoType } },
      create: { clientId, workFlowType, subjectType, photoType, featureCode: input.featureCode ?? null, isRequired: input.isRequired, sortOrder: input.sortOrder ?? 0 },
      update: { isRequired: input.isRequired, featureCode: input.featureCode ?? null, ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }) },
    });
  }

  async complete(clientId: string, photoId: string) {
    const photo = await this.getPhoto(clientId, photoId);
    if (isPaymentSubject(photo.workFlowType, photo.subjectType)) throw new ForbiddenException('Payment receipts use the payment transaction routes.');
    if (photo.workFlowType === PhotoWorkflowType.FLEET_PREPARATION)
      throw new ForbiddenException(
        'Preparation photos use the preparation routes.',
      );
    if (photo.workFlowType === PhotoWorkflowType.SUPPORT && photo.subjectType === PhotoSubjectType.SUPPORT_TICKET)
      throw new ForbiddenException(
        'Support attachments use the support ticket routes.',
      );
    return this.completePhoto(clientId, photo);
  }

  async completeSupport(clientId: string, ticketId: string, photoId: string) {
    const photo = await this.getPhoto(clientId, photoId);
    if (
      (photo.workFlowType !== PhotoWorkflowType.SUPPORT || photo.subjectType !== PhotoSubjectType.SUPPORT_TICKET) ||
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
      if ((photo.subjectType === PhotoSubjectType.FLEET && (photo.workFlowType === PhotoWorkflowType.FLEET_ALLOTMENT || photo.workFlowType === PhotoWorkflowType.FLEET_SUBMISSION)))
        await tx.$queryRaw`SELECT id FROM "Inspection" WHERE id=${photo.entityId} AND "clientId"=${clientId} FOR UPDATE`;
      const reports =
        (photo.subjectType === PhotoSubjectType.FLEET && (photo.workFlowType === PhotoWorkflowType.FLEET_ALLOTMENT || photo.workFlowType === PhotoWorkflowType.FLEET_SUBMISSION))
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
          workFlowType: photo.workFlowType, subjectType: photo.subjectType,
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
    if (isPaymentSubject(photo.workFlowType, photo.subjectType)) throw new ForbiddenException('Payment receipts use the payment transaction routes.');
    await this.assertFleetManagerPhotoAccess(clientId, actor, photo);
    if (photo.workFlowType === PhotoWorkflowType.FLEET_PREPARATION)
      throw new ForbiddenException(
        'Preparation photos use the preparation routes.',
      );
    if (photo.workFlowType === PhotoWorkflowType.SUPPORT && photo.subjectType === PhotoSubjectType.SUPPORT_TICKET)
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
      (photo.workFlowType !== PhotoWorkflowType.SUPPORT || photo.subjectType !== PhotoSubjectType.SUPPORT_TICKET) ||
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
      !actor.roles.some((role) => role === UserRole.CLIENT_ADMIN || role === UserRole.KYC_OPERATOR),
    );
  }

  private async assertFleetManagerEntityAccess(clientId: string, actor: AuthUser | undefined, workflow: PhotoWorkflowType, subject: PhotoSubjectType, entityId: string) {
    if (!actor || !this.fleetScoped(actor)) return;
    if (workflow !== PhotoWorkflowType.RIDER_ONBOARDING) return;
    const visible = await fleetManagerVisibleSubjects(this.prisma, clientId, actor.id);
    const allowed = subject === PhotoSubjectType.PROFILE
      ? visible.riderIds.includes(entityId)
      : (await this.visibleOnboardingProgress(clientId, entityId, visible.userIds)) || visible.riderIds.includes(entityId);
    if (!allowed) throw new NotFoundException('Media entity not found.');
  }

  private async visibleOnboardingProgress(clientId: string, progressId: string, userIds: string[]) {
    if (!userIds.length) return false;
    return !!(await this.prisma.riderOnboardingProgress.findFirst({ where: { id: progressId, clientId, userId: { in: userIds } }, select: { id: true } }));
  }

  private async assertFleetManagerPhotoAccess(clientId: string, actor: AuthUser | undefined, photo: { workFlowType: PhotoWorkflowType; subjectType: PhotoSubjectType; entityId: string; id: string }) {
    if (!actor || !this.fleetScoped(actor)) return;
    if ((photo.workFlowType === PhotoWorkflowType.FLEET_ALLOTMENT || photo.workFlowType === PhotoWorkflowType.FLEET_SUBMISSION) && photo.subjectType === PhotoSubjectType.FLEET) {
      const hubs = await this.prisma.userHub.findMany({ where: { clientId, userId: actor.id, hub: { clientId, status: 'ACTIVE', deletedAt: null } }, select: { hubId: true } });
      const inspection = await this.prisma.inspection.findFirst({ where: { id: photo.entityId, clientId, allocation: { clientId, fleet: { clientId, deletedAt: null, currentHubId: { in: hubs.map((hub) => hub.hubId) } } } }, select: { id: true } });
      if (!inspection) throw new NotFoundException('Photo not found.');
      return;
    }
    try { await this.assertFleetManagerEntityAccess(clientId, actor, photo.workFlowType, photo.subjectType, photo.entityId); }
    catch (error) { if (error instanceof NotFoundException) throw new NotFoundException('Photo not found.'); throw error; }
  }

  private async assertEntityOwnership(clientId: string, workflow: PhotoWorkflowType, subject: PhotoSubjectType, entityId: string) {
    const where = { id: entityId, clientId };
    let exists = false;
    if (workflow === PhotoWorkflowType.PAYMENT) {
      if (subject === PhotoSubjectType.OTHER) exists = !!(await this.prisma.deploymentPayment.findFirst({ where })) || !!(await this.prisma.riderPayment.findFirst({ where }));
      else if (subject === PhotoSubjectType.COLLECTION) exists = !!(await this.prisma.paymentCollectionRequest.findFirst({ where }));
      else if (subject === PhotoSubjectType.AUTOPAY) exists = !!(await this.prisma.paymentTransaction.findFirst({ where }));
      else if (subject === PhotoSubjectType.ONBOARDING_FEES) exists = !!(await this.prisma.riderPayment.findFirst({ where }));
    } else if (workflow === PhotoWorkflowType.RIDER_ONBOARDING && subject === PhotoSubjectType.PROFILE) exists = !!(await this.prisma.rider.findFirst({ where: { ...where, deletedAt: null } }));
    else if (workflow === PhotoWorkflowType.RIDER_ONBOARDING) exists = !!(await this.prisma.riderOnboardingProgress.findFirst({ where }));
    else if (workflow === PhotoWorkflowType.FLEET_INSPECTION) {
      if (subject === PhotoSubjectType.FLEET) exists = !!(await this.prisma.fleet.findFirst({ where: { ...where, deletedAt: null } }));
      else if (subject === PhotoSubjectType.BATTERY) exists = !!(await this.prisma.battery.findFirst({ where }));
      else if (subject === PhotoSubjectType.CONTROLLER) exists = !!(await this.prisma.controller.findFirst({ where }));
      else if (subject === PhotoSubjectType.IOT_DEVICE) exists = !!(await this.prisma.ioTDevice.findFirst({ where }));
      else if (([PhotoSubjectType.MOTOR, PhotoSubjectType.TYRE, PhotoSubjectType.DOCK, PhotoSubjectType.CHASSIS, PhotoSubjectType.DASHBOARD] as PhotoSubjectType[]).includes(subject)) exists = !!(await this.prisma.fleet.findFirst({ where: { ...where, deletedAt: null } }));
    } else if ((workflow === PhotoWorkflowType.FLEET_ALLOTMENT || workflow === PhotoWorkflowType.FLEET_SUBMISSION) && subject === PhotoSubjectType.FLEET) exists = !!(await this.prisma.inspection.findFirst({ where }));
    else if (workflow === PhotoWorkflowType.SUPPORT && subject === PhotoSubjectType.SUPPORT_TICKET) exists = !!(await this.prisma.supportTicket.findFirst({ where }));
    else if (workflow === PhotoWorkflowType.FLEET_PREPARATION && subject === PhotoSubjectType.FLEET) exists = !!(await this.prisma.fleetPreparationRevision.findFirst({ where }));
    else if (workflow === PhotoWorkflowType.FLEET_PREPARATION && subject === PhotoSubjectType.OTHER) { const stageId = entityId.split(':')[1]; exists = !!stageId && !!(await this.prisma.fleetInstallationStage.findFirst({ where: { id: stageId, clientId } })); }
    if (!exists) throw new NotFoundException('Media entity not found.');
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
