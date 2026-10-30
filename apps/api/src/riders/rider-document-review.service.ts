import { fleetManagerVisibleSubjects } from '../rider-access/rider-hub-policy.js';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RiderDocumentReviewStatus, UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RiderOnboardingConfigurationService } from './rider-onboarding-configuration.service.js';
import type { ListRiderDocumentsDto } from './dto/rider-document.dto.js';
import { RiderKycStatusService } from './rider-kyc-status.service.js';

@Injectable()
export class RiderDocumentReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configuration: RiderOnboardingConfigurationService,
    private readonly kyc: RiderKycStatusService,
  ) {}

  async list(clientId: string, query: ListRiderDocumentsDto, actor?: AuthUser) {
    const nameFieldCode = await this.riderNameFieldCode(clientId);
    const userIds = await this.fleetManagerDocumentUserIds(clientId, actor);
    const where: Prisma.RiderOnboardingDocumentWhereInput = {
      clientId,
      supersededAt: null,
      ...(userIds ? { userId: { in: userIds } } : {}),
      ...(query.status
        ? { status: query.status as RiderDocumentReviewStatus }
        : {}),
      ...(query.search
        ? {
            OR: [
              { fieldCode: { contains: query.search, mode: 'insensitive' } },
              {
                user: { name: { contains: query.search, mode: 'insensitive' } },
              },
              { user: { mobile: { contains: query.search } } },
              {
                rider: {
                  riderCode: { contains: query.search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };
    const documents = await this.prisma.riderOnboardingDocument.findMany({
      where,
      include: {
        feature: { select: { id: true, code: true, name: true } },
        photo: {
          select: {
            id: true,
            objectKey: true,
            mimeType: true,
            sizeBytes: true,
            status: true,
            uploadedAt: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            mobile: true,
            riderOnboardingProgress: { select: { values: true } },
          },
        },
        rider: {
          select: { id: true, riderCode: true, name: true, mobile: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return documents.map((document) =>
      this.withRiderName(document, nameFieldCode),
    );
  }

  async get(clientId: string, id: string, actor?: AuthUser) {
    const nameFieldCode = await this.riderNameFieldCode(clientId);
    const userIds = await this.fleetManagerDocumentUserIds(clientId, actor);
    const document = await this.prisma.riderOnboardingDocument.findFirst({
      where: { id, clientId, ...(userIds ? { userId: { in: userIds } } : {}) },
      include: {
        feature: { select: { id: true, code: true, name: true } },
        photo: {
          select: {
            id: true,
            objectKey: true,
            mimeType: true,
            sizeBytes: true,
            status: true,
            uploadedAt: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            mobile: true,
            riderOnboardingProgress: { select: { values: true } },
          },
        },
        rider: {
          select: { id: true, riderCode: true, name: true, mobile: true },
        },
      },
    });
    if (!document) throw new NotFoundException('Rider document not found.');
    return this.withRiderName(document, nameFieldCode);
  }

  async approve(
    clientId: string,
    reviewerId: string,
    id: string,
    actor?: AuthUser,
  ) {
    return this.review(clientId, reviewerId, id, RiderDocumentReviewStatus.APPROVED, null, actor);
  }

  async reject(
    clientId: string,
    reviewerId: string,
    id: string,
    rejectionReason: string,
    actor?: AuthUser,
  ) {
    if (!rejectionReason.trim())
      throw new BadRequestException('A rejection reason is required.');
    return this.review(clientId, reviewerId, id, RiderDocumentReviewStatus.REJECTED, rejectionReason.trim(), actor);
  }

  private async review(clientId: string, reviewerId: string, id: string, status: RiderDocumentReviewStatus, rejectionReason: string | null, actor?: AuthUser) {
    const pending = await this.assertPending(clientId, id, actor);
    const fields = await this.kyc.fields(clientId);
    return this.prisma.$transaction(async tx => {
      await this.kyc.lockUser(tx, clientId, pending.userId);
      const updated = await tx.riderOnboardingDocument.updateMany({
        where: { id, clientId, userId: pending.userId, supersededAt: null, status: RiderDocumentReviewStatus.PENDING },
        data: { status, rejectionReason, reviewedById: reviewerId, reviewedAt: new Date() },
      });
      if (updated.count !== 1) throw new BadRequestException('Only pending documents can be reviewed.');
      const document = await tx.riderOnboardingDocument.findUniqueOrThrow({ where: { id } });
      const kyc = await this.kyc.sync(tx, clientId, pending.userId, fields);
      return { ...document, ...kyc };
    });
  }

  async allocationBlockers(clientId: string, riderId: string) {
    const rider = await this.prisma.rider.findFirst({
      where: { id: riderId, clientId, deletedAt: null },
      select: { id: true, userId: true },
    });
    if (!rider?.userId)
      return [
        {
          fieldCode: 'RIDER_ONBOARDING',
          reason: 'Rider onboarding is incomplete.',
        },
      ];
    const effective =
      await this.configuration.getEffectiveConfiguration(clientId);
    const uploadFields = effective.onboarding.steps.flatMap((step) =>
      step.fields.filter((field) => field.isUpload && field.fieldCode),
    );
    if (!uploadFields.length) return [];
    const documents = await this.prisma.riderOnboardingDocument.findMany({
      where: { clientId, userId: rider.userId, supersededAt: null },
      select: { fieldCode: true, status: true, rejectionReason: true },
    });
    const byCode = new Map(
      documents.map((document) => [document.fieldCode, document]),
    );
    const blockers: Array<{ fieldCode: string; reason: string }> = [];
    for (const field of uploadFields) {
      const document = byCode.get(field.fieldCode);
      if (!document && field.required)
        blockers.push({
          fieldCode: field.fieldCode,
          reason: 'Required document has not been uploaded.',
        });
      else if (
        document &&
        document.status !== RiderDocumentReviewStatus.APPROVED
      )
        blockers.push({
          fieldCode: field.fieldCode,
          reason:
            document.status === RiderDocumentReviewStatus.REJECTED
              ? (document.rejectionReason ?? 'Document was rejected.')
              : 'Document verification is pending.',
        });
    }
    return blockers;
  }

  private withFileName<T extends { photo: { objectKey: string } }>(
    document: T,
  ) {
    const fileName =
      document.photo.objectKey.split('/').pop() ?? document.photo.objectKey;
    return { ...document, photo: { ...document.photo, fileName } };
  }

  private async riderNameFieldCode(clientId: string) {
    const configuration =
      await this.configuration.getEffectiveConfiguration(clientId);
    return configuration.onboarding.steps
      .flatMap((step) => step.fields)
      .find((field) => field.storageKey === 'name')?.fieldCode;
  }

  private withRiderName<
    T extends {
      photo: { objectKey: string };
      rider: { name: string } | null;
      user: {
        name: string;
        riderOnboardingProgress: { values: unknown } | null;
      };
    },
  >(document: T, nameFieldCode?: string) {
    const values = document.user.riderOnboardingProgress?.values;
    const enteredName =
      values && typeof values === 'object' && !Array.isArray(values)
        ? ((values as Record<string, unknown>)[nameFieldCode ?? 'FULL_NAME'] ??
          (values as Record<string, unknown>).FULL_NAME)
        : null;
    const riderName =
      document.rider?.name?.trim() ||
      (typeof enteredName === 'string' ? enteredName.trim() : '') ||
      (/^pending (rider|user)$/i.test(document.user.name.trim())
        ? 'Name not provided'
        : document.user.name);
    const { riderOnboardingProgress: _progress, ...user } = document.user;
    return this.withFileName({ ...document, user, riderName });
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

  private async fleetManagerDocumentUserIds(
    clientId: string,
    actor?: AuthUser,
  ) {
    if (!actor || !this.fleetScoped(actor)) return undefined;
    return (await fleetManagerVisibleSubjects(this.prisma, clientId, actor.id))
      .userIds;
  }

  private async assertPending(clientId: string, id: string, actor?: AuthUser) {
    const userIds = await this.fleetManagerDocumentUserIds(clientId, actor);
    const document = await this.prisma.riderOnboardingDocument.findFirst({
      where: {
        id,
        clientId,
        supersededAt: null,
        ...(userIds ? { userId: { in: userIds } } : {}),
      },
      select: { status: true, userId: true },
    });
    if (!document) throw new NotFoundException('Rider document not found.');
    if (document.status !== RiderDocumentReviewStatus.PENDING)
      throw new BadRequestException('Only pending documents can be reviewed.');
    return document;
  }
}
