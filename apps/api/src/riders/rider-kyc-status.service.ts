import { Injectable, NotFoundException } from '@nestjs/common';
import { KycStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { RiderOnboardingConfigurationService } from './rider-onboarding-configuration.service.js';

type Field = {
  fieldCode: string;
  isUpload: boolean;
  required: boolean;
  disabled: boolean;
};
type Document = { fieldCode: string; status: string; reviewedAt: Date | null };
type ProviderKyc = { status: string; verifiedAt: Date | null };

/** Current document versions are the authority whenever document review is configured. */
export function documentKycStatus(
  fields: Field[],
  documents: Document[],
  providerKycs: ProviderKyc[] = [],
) {
  const uploads = fields.filter(
    (field) => field.isUpload && field.fieldCode && !field.disabled,
  );
  const codes = new Set(uploads.map((field) => field.fieldCode));
  const relevant = documents.filter((document) =>
    codes.has(document.fieldCode),
  );
  const result = (kycStatus: KycStatus, kycVerifiedAt: Date | null = null) => ({
    kycStatus,
    kycVerifiedAt,
  });
  if (!uploads.length) {
    if (!providerKycs.length) return result(KycStatus.NOT_STARTED);
    if (providerKycs.some((kyc) => kyc.status === 'FAILED'))
      return result(KycStatus.FAILED);
    if (providerKycs.every((kyc) => kyc.status === 'VERIFIED')) {
      const dates = providerKycs.flatMap((kyc) =>
        kyc.verifiedAt ? [kyc.verifiedAt.getTime()] : [],
      );
      return result(
        KycStatus.VERIFIED,
        dates.length ? new Date(Math.max(...dates)) : null,
      );
    }
    return result(KycStatus.PENDING);
  }
  if (relevant.some((document) => document.status === 'REJECTED'))
    return result(KycStatus.FAILED);
  const byCode = new Map(
    relevant.map((document) => [document.fieldCode, document]),
  );
  if (uploads.some((field) => field.required && !byCode.has(field.fieldCode)))
    return result(KycStatus.PENDING);
  if (!relevant.length) return result(KycStatus.NOT_STARTED);
  if (relevant.some((document) => document.status !== 'APPROVED'))
    return result(KycStatus.PENDING);
  const dates = relevant.flatMap((document) =>
    document.reviewedAt ? [document.reviewedAt.getTime()] : [],
  );
  return result(
    KycStatus.VERIFIED,
    dates.length ? new Date(Math.max(...dates)) : null,
  );
}

@Injectable()
export class RiderKycStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configuration: RiderOnboardingConfigurationService,
  ) {}

  async fields(clientId: string) {
    try {
      const effective =
        await this.configuration.getEffectiveConfiguration(clientId);
      return effective.onboarding.steps.flatMap((step) => step.fields);
    } catch (error) {
      // Legacy/provider-only workspaces may have no published onboarding workflow.
      if (
        error instanceof NotFoundException &&
        error.message ===
          'Published workflow is unavailable for this workspace.'
      )
        return [];
      throw error;
    }
  }

  // Serialize approvals and replacement uploads for a user, including before a Rider exists.
  async lockUser(
    tx: Prisma.TransactionClient,
    clientId: string,
    userId: string,
  ) {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} AND "clientId" = ${clientId} FOR UPDATE`;
  }

  async forUser(
    clientId: string,
    userId: string,
    fields?: Field[],
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const [configured, documents, providerKycs] = await Promise.all([
      fields ?? this.fields(clientId),
      db.riderOnboardingDocument.findMany({
        where: { clientId, userId, supersededAt: null },
        select: { fieldCode: true, status: true, reviewedAt: true },
      }),
      db.riderKyc.findMany({
        where: { clientId, rider: { clientId, userId, deletedAt: null } },
        select: { status: true, verifiedAt: true },
      }),
    ]);
    return documentKycStatus(configured, documents, providerKycs);
  }

  async sync(
    tx: Prisma.TransactionClient,
    clientId: string,
    userId: string,
    fields: Field[],
  ) {
    const status = await this.forUser(clientId, userId, fields, tx);
    await tx.rider.updateMany({
      where: { clientId, userId, deletedAt: null },
      data: status,
    });
    return status;
  }

  async decorate<T extends { id: string; userId: string | null }>(
    clientId: string,
    riders: T[],
  ) {
    if (!riders.length) return [];
    const [fields, documents, kycs] = await Promise.all([
      this.fields(clientId),
      this.prisma.riderOnboardingDocument.findMany({
        where: {
          clientId,
          userId: {
            in: riders.flatMap((rider) => (rider.userId ? [rider.userId] : [])),
          },
          supersededAt: null,
        },
        select: {
          userId: true,
          fieldCode: true,
          status: true,
          reviewedAt: true,
        },
      }),
      this.prisma.riderKyc.findMany({
        where: { clientId, riderId: { in: riders.map((rider) => rider.id) } },
        select: { riderId: true, status: true, verifiedAt: true },
      }),
    ]);
    return riders.map((rider) => ({
      ...rider,
      ...documentKycStatus(
        fields,
        documents.filter((document) => document.userId === rider.userId),
        kycs.filter((kyc) => kyc.riderId === rider.id),
      ),
    }));
  }

  async summary(clientId: string) {
    const fields = await this.fields(clientId);
    // One query for all riders; multiple provider checks never multiply the rider count.
    const riders = await this.prisma.rider.findMany({
      where: { clientId, deletedAt: null },
      select: {
        kycs: {
          where: { clientId },
          select: { status: true, verifiedAt: true },
        },
        user: {
          select: {
            riderOnboardingDocuments: {
              where: { clientId, supersededAt: null },
              select: { fieldCode: true, status: true, reviewedAt: true },
            },
          },
        },
      },
    });
    const counts: Record<string, number> = {
      VERIFIED: 0,
      PENDING: 0,
      FAILED: 0,
      NOT_STARTED: 0,
    };
    for (const rider of riders) {
      const { kycStatus } = documentKycStatus(
        fields,
        rider.user?.riderOnboardingDocuments ?? [],
        rider.kycs,
      );
      counts[kycStatus] = (counts[kycStatus] ?? 0) + 1;
    }
    return counts;
  }
}
