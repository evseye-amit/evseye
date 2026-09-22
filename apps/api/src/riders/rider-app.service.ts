import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PhotoEntityType, PhotoStatus, Prisma, RiderDocumentReviewStatus, UserRole } from '@prisma/client';
import { normalizeIndianMobile } from '../common/phone.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RiderOnboardingConfigurationService } from './rider-onboarding-configuration.service.js';
import { MediaService } from '../media/media.service.js';
import type { CreateUploadIntentDto } from '../media/dto/create-upload-intent.dto.js';

@Injectable()
export class RiderAppService {
  constructor(private readonly prisma: PrismaService, private readonly configuration: RiderOnboardingConfigurationService, private readonly media: MediaService) {}

  async enroll(companyCode: string, phone: string) {
    const client = await this.prisma.client.findFirst({ where: { companyCode, isActive: true, status: 'ACTIVE' }, select: { id: true } });
    if (!client) throw new BadRequestException('Client workspace is unavailable.');
    const mobile = normalizeIndianMobile(phone);
    const existing = await this.prisma.user.findFirst({ where: { clientId: client.id, mobile } });
    if (existing && existing.role !== UserRole.RIDER) throw new ConflictException('This mobile number is already assigned to another role.');
    const user = existing ?? await this.prisma.user.create({ data: { clientId: client.id, mobile, name: 'Pending Rider', role: UserRole.RIDER } });
    const configuration = await this.configuration.getEffectiveConfiguration(client.id);
    await this.prisma.riderOnboardingProgress.upsert({ where: { userId: user.id }, create: { clientId: client.id, userId: user.id, packageId: configuration.package.id, currentStepId: configuration.onboarding.steps[0]?.stepId }, update: {} });
    return { clientId: client.id, userId: user.id, phone: mobile };
  }

  async onboarding(clientId: string, userId: string) {
    const configuration = await this.configuration.getEffectiveConfiguration(clientId);
    const progress = await this.prisma.riderOnboardingProgress.upsert({ where: { userId }, create: { clientId, userId, packageId: configuration.package.id, currentStepId: configuration.onboarding.steps[0]?.stepId }, update: { packageId: configuration.package.id } });
    const completed = new Set((progress.completedStepIds as string[]) ?? []);
    const skipped = new Set((progress.skippedStepIds as string[]) ?? []);
    const documents = await this.prisma.riderOnboardingDocument.findMany({
      where: { clientId, userId, supersededAt: null },
      select: { fieldCode: true, status: true, rejectionReason: true, updatedAt: true },
    });
    const fields = configuration.onboarding.steps.flatMap((step) =>
      step.fields.map((field) => ({ ...field, stepId: step.stepId, stepName: step.stepName })),
    );
    const fieldsByCode = new Map(fields.map((field) => [field.fieldCode, field]));
    const rejected = documents
      .filter((document) => document.status === RiderDocumentReviewStatus.REJECTED)
      .map((document) => {
        const field = fieldsByCode.get(document.fieldCode);
        return {
          ...document,
          step: field ? { stepId: field.stepId, stepName: field.stepName } : null,
        };
      });
    const pendingCount = documents.filter(
      (document) => document.status === RiderDocumentReviewStatus.PENDING,
    ).length;
    const next = rejected[0]?.step?.stepId
      ? configuration.onboarding.steps.find((step) => step.stepId === rejected[0].step?.stepId) ?? null
      : configuration.onboarding.steps.find((step) => !completed.has(step.stepId) && !skipped.has(step.stepId)) ?? null;
    const screen = rejected.length
      ? 'DOCUMENT_RESUBMISSION'
      : pendingCount && progress.completedAt
        ? 'DOCUMENT_REVIEW_PENDING'
        : progress.completedAt
          ? 'WAITING_FOR_FLEET'
          : 'ONBOARDING';
    return {
      ...this.configuration.toPublicConfiguration(configuration),
      screen,
      documentReview: { documents, rejected, pendingCount },
      progress: {
        currentStepId: next?.stepId ?? null,
        completedStepIds: [...completed],
        skippedStepIds: [...skipped],
        values: progress.values,
        completed: Boolean(progress.completedAt),
      },
    };
  }

  async saveStep(clientId: string, userId: string, stepId: string, values: Record<string, unknown>, skip = false) {
    const effective = await this.configuration.getEffectiveConfiguration(clientId);
    const step = effective.onboarding.steps.find((item) => item.stepId === stepId);
    if (!step) throw new BadRequestException('This onboarding step is not available in the active package.');
    const allowed = new Set(step.fields.filter((field) => field.fieldCode).map((field) => field.fieldCode));
    for (const code of Object.keys(values)) if (!allowed.has(code)) throw new BadRequestException(`${code} is not available in this onboarding step.`);
    const current = await this.prisma.riderOnboardingProgress.findUnique({ where: { userId } });
    if (!current) throw new BadRequestException('Rider onboarding has not been started.');
    if (!skip) {
      const uploaded = await this.prisma.riderOnboardingDocument.findMany({ where: { clientId, userId, supersededAt: null }, select: { fieldCode: true, status: true } });
      const uploads = new Map(uploaded.map((document) => [document.fieldCode, document.status]));
      for (const field of step.fields) {
        if (!field.required || !field.fieldCode) continue;
        if (field.isUpload) {
          const status = uploads.get(field.fieldCode);
          if (!status || status === RiderDocumentReviewStatus.REJECTED) throw new BadRequestException(`${field.fieldCode} must be uploaded before continuing.`);
        } else if (!values[field.fieldCode]) throw new BadRequestException(`${field.fieldCode} is required.`);
      }
    }
    const completed = new Set((current.completedStepIds as string[]) ?? []); const skipped = new Set((current.skippedStepIds as string[]) ?? []);
    skip ? skipped.add(stepId) : completed.add(stepId);
    const merged = { ...((current.values as Record<string, unknown>) ?? {}), ...values };
    const allFinished = effective.onboarding.steps.every((item) => completed.has(item.stepId) || skipped.has(item.stepId));
    const storedValues = allFinished
      ? Object.fromEntries(
          effective.onboarding.steps
            .flatMap((item) => item.fields)
            .filter((field) => field.fieldCode && field.storageKey && merged[field.fieldCode] !== undefined)
            .map((field) => [field.fieldCode, merged[field.fieldCode]]),
        )
      : {};
    const riderValues = allFinished
      ? (await this.configuration.validateAndMapValues(clientId, storedValues, 'CREATE', {}, { requireAll: false })).data
      : {};
    await this.prisma.$transaction(async (tx) => {
      await tx.riderOnboardingProgress.update({ where: { userId }, data: { values: merged as Prisma.InputJsonValue, completedStepIds: [...completed], skippedStepIds: [...skipped], ...(allFinished ? { completedAt: new Date() } : {}) } });
      if (allFinished && !(await tx.rider.findUnique({ where: { userId } }))) {
        const data: Record<string, unknown> = {
          ...riderValues,
          clientId,
          userId,
          status: 'ACTIVE',
          name: String(riderValues.name ?? 'Rider'),
          mobile: String(riderValues.mobile ?? ''),
        };
        const rider = await tx.rider.create({ data: data as never });
        await tx.riderOnboardingDocument.updateMany({ where: { clientId, userId, riderId: null }, data: { riderId: rider.id } });
        await tx.user.update({ where: { id: userId }, data: { name: data.name as string } });
      }
    });
    return this.onboarding(clientId, userId);
  }

  private async uploadField(clientId: string, userId: string, fieldCode: string) {
    const effective = await this.configuration.getEffectiveConfiguration(clientId);
    const field = effective.onboarding.steps.flatMap((step) => step.fields.map((item) => ({ ...item, stepId: step.stepId }))).find((item) => item.fieldCode === fieldCode);
    if (!field?.isUpload) throw new BadRequestException(`${fieldCode} is not an upload field in the active package.`);
    const progress = await this.prisma.riderOnboardingProgress.findUnique({ where: { userId }, select: { id: true } });
    if (!progress) throw new BadRequestException('Rider onboarding has not been started.');
    return { field, progressId: progress.id };
  }

  async createDocumentUploadIntent(clientId: string, userId: string, input: { fieldCode: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'; fileName: string; sizeBytes: number }) {
    const { field, progressId } = await this.uploadField(clientId, userId, input.fieldCode);
    const uploadConfiguration = (field.configuration ?? {}) as Record<string, unknown>;
    const explicitMimeTypes = Array.isArray(uploadConfiguration.allowedMimeTypes)
      ? uploadConfiguration.allowedMimeTypes.filter((value): value is string => typeof value === 'string')
      : [];
    const fileTypeMimes: Record<string, string> = { PDF: 'application/pdf', JPG: 'image/jpeg', JPEG: 'image/jpeg', PNG: 'image/png', WEBP: 'image/webp' };
    const allowedMimeTypes = explicitMimeTypes.length ? explicitMimeTypes
      : Array.isArray(uploadConfiguration.allowedFileTypes)
        ? uploadConfiguration.allowedFileTypes.map((value) => fileTypeMimes[String(value).toUpperCase()]).filter(Boolean)
        : [];
    if (allowedMimeTypes.length && !allowedMimeTypes.includes(input.mimeType)) {
      throw new BadRequestException(`${field.label} does not accept this file type.`);
    }
    const maxFileSizeBytes = Number(uploadConfiguration.maxFileSizeBytes ?? uploadConfiguration.maxFileSize ??
      (uploadConfiguration.maxFileSizeMB ? Number(uploadConfiguration.maxFileSizeMB) * 1024 * 1024 : 0));
    if (Number.isFinite(maxFileSizeBytes) && maxFileSizeBytes > 0 && input.sizeBytes > maxFileSizeBytes) {
      throw new BadRequestException(`${field.label} exceeds the allowed file size.`);
    }
    const dto: CreateUploadIntentDto = {
      entityType: PhotoEntityType.RIDER_ONBOARDING,
      entityId: progressId,
      photoType: `RIDER_DOCUMENT_${field.fieldCode}`,
      mimeType: input.mimeType,
      fileName: input.fileName,
      sizeBytes: input.sizeBytes,
    };
    return this.media.createUploadIntent(clientId, userId, dto);
  }

  async completeDocumentUpload(clientId: string, userId: string, photoId: string) {
    const photo = await this.prisma.photo.findFirst({ where: { id: photoId, clientId, uploadedById: userId, entityType: PhotoEntityType.RIDER_ONBOARDING, status: PhotoStatus.PENDING_UPLOAD }, select: { id: true, photoType: true } });
    if (!photo?.photoType.startsWith('RIDER_DOCUMENT_')) throw new BadRequestException('Rider onboarding document upload not found.');
    const fieldCode = photo.photoType.slice('RIDER_DOCUMENT_'.length);
    const { field } = await this.uploadField(clientId, userId, fieldCode);
    const completed = await this.media.complete(clientId, photoId);
    const rider = await this.prisma.rider.findUnique({ where: { userId }, select: { id: true } });
    const document = await this.prisma.$transaction(async (tx) => {
      await tx.riderOnboardingDocument.updateMany({ where: { clientId, userId, fieldCode, supersededAt: null }, data: { status: RiderDocumentReviewStatus.SUPERSEDED, supersededAt: new Date() } });
      return tx.riderOnboardingDocument.create({ data: { clientId, userId, riderId: rider?.id, featureId: field.featureId, fieldCode, photoId: completed.id } });
    });
    return { photo: completed, document };
  }
}
