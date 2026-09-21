import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RiderDocumentReviewStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { RiderOnboardingConfigurationService } from './rider-onboarding-configuration.service.js';
import type { ListRiderDocumentsDto } from './dto/rider-document.dto.js';

@Injectable()
export class RiderDocumentReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configuration: RiderOnboardingConfigurationService,
  ) {}

  async list(clientId: string, query: ListRiderDocumentsDto) {
    const where: Prisma.RiderOnboardingDocumentWhereInput = {
      clientId,
      supersededAt: null,
      ...(query.status ? { status: query.status as RiderDocumentReviewStatus } : {}),
      ...(query.search ? { OR: [
        { fieldCode: { contains: query.search, mode: 'insensitive' } },
        { user: { name: { contains: query.search, mode: 'insensitive' } } },
        { user: { mobile: { contains: query.search } } },
        { rider: { riderCode: { contains: query.search, mode: 'insensitive' } } },
      ] } : {}),
    };
    const documents = await this.prisma.riderOnboardingDocument.findMany({
      where,
      include: {
        feature: { select: { id: true, code: true, name: true } },
        photo: { select: { id: true, objectKey: true, mimeType: true, sizeBytes: true, status: true, uploadedAt: true } },
        user: { select: { id: true, name: true, mobile: true } },
        rider: { select: { id: true, riderCode: true, name: true, mobile: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return documents.map((document) => this.withFileName(document));
  }

  async get(clientId: string, id: string) {
    const document = await this.prisma.riderOnboardingDocument.findFirst({
      where: { id, clientId },
      include: {
        feature: { select: { id: true, code: true, name: true } },
        photo: { select: { id: true, objectKey: true, mimeType: true, sizeBytes: true, status: true, uploadedAt: true } },
        user: { select: { id: true, name: true, mobile: true } },
        rider: { select: { id: true, riderCode: true, name: true, mobile: true } },
      },
    });
    if (!document) throw new NotFoundException('Rider document not found.');
    return this.withFileName(document);
  }

  async approve(clientId: string, reviewerId: string, id: string) {
    await this.assertPending(clientId, id);
    return this.prisma.riderOnboardingDocument.update({
      where: { id },
      data: { status: RiderDocumentReviewStatus.APPROVED, rejectionReason: null, reviewedById: reviewerId, reviewedAt: new Date() },
    });
  }

  async reject(clientId: string, reviewerId: string, id: string, rejectionReason: string) {
    if (!rejectionReason.trim()) throw new BadRequestException('A rejection reason is required.');
    await this.assertPending(clientId, id);
    return this.prisma.riderOnboardingDocument.update({
      where: { id },
      data: { status: RiderDocumentReviewStatus.REJECTED, rejectionReason: rejectionReason.trim(), reviewedById: reviewerId, reviewedAt: new Date() },
    });
  }

  async allocationBlockers(clientId: string, riderId: string) {
    const rider = await this.prisma.rider.findFirst({ where: { id: riderId, clientId, deletedAt: null }, select: { id: true, userId: true } });
    if (!rider?.userId) return [{ fieldCode: 'RIDER_ONBOARDING', reason: 'Rider onboarding is incomplete.' }];
    const effective = await this.configuration.getEffectiveConfiguration(clientId);
    const uploadFields = effective.onboarding.steps.flatMap((step) => step.fields.filter((field) => field.isUpload && field.fieldCode));
    if (!uploadFields.length) return [];
    const documents = await this.prisma.riderOnboardingDocument.findMany({
      where: { clientId, userId: rider.userId, supersededAt: null },
      select: { fieldCode: true, status: true, rejectionReason: true },
    });
    const byCode = new Map(documents.map((document) => [document.fieldCode, document]));
    const blockers: Array<{ fieldCode: string; reason: string }> = [];
    for (const field of uploadFields) {
      const document = byCode.get(field.fieldCode);
      if (!document && field.required) blockers.push({ fieldCode: field.fieldCode, reason: 'Required document has not been uploaded.' });
      else if (document && document.status !== RiderDocumentReviewStatus.APPROVED) blockers.push({ fieldCode: field.fieldCode, reason: document.status === RiderDocumentReviewStatus.REJECTED ? document.rejectionReason ?? 'Document was rejected.' : 'Document verification is pending.' });
    }
    return blockers;
  }

  private withFileName<T extends { photo: { objectKey: string } }>(document: T) {
    const fileName = document.photo.objectKey.split('/').pop() ?? document.photo.objectKey;
    return { ...document, photo: { ...document.photo, fileName } };
  }

  private async assertPending(clientId: string, id: string) {
    const document = await this.prisma.riderOnboardingDocument.findFirst({ where: { id, clientId, supersededAt: null }, select: { status: true } });
    if (!document) throw new NotFoundException('Rider document not found.');
    if (document.status !== RiderDocumentReviewStatus.PENDING) throw new BadRequestException('Only pending documents can be reviewed.');
  }
}
