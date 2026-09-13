import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { KycStatus, KycType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CompleteKycDto } from './dto/complete-kyc.dto.js';
import type { StartKycDto } from './dto/start-kyc.dto.js';
import {
  KYC_PROVIDER,
  type KycProvider,
} from './providers/kyc-provider.interface.js';

@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(KYC_PROVIDER) private readonly provider: KycProvider,
  ) {}

  async list(clientId: string, riderId: string) {
    await this.assertRider(clientId, riderId);
    return this.prisma.riderKyc.findMany({
      where: { clientId, riderId },
      orderBy: { type: 'asc' },
    });
  }

  async start(clientId: string, riderId: string, dto: StartKycDto) {
    await this.assertRider(clientId, riderId);
    const existing = await this.prisma.riderKyc.findUnique({
      where: { riderId_type: { riderId, type: dto.type as KycType } },
    });
    if (
      existing?.status === KycStatus.PENDING ||
      existing?.status === KycStatus.VERIFIED
    ) {
      throw new BadRequestException(
        'KYC verification is already active or complete.',
      );
    }
    const result = await this.provider.start({
      clientId,
      riderId,
      type: dto.type as KycType,
      referenceHint: dto.referenceHint,
    });
    return this.prisma.riderKyc.upsert({
      where: { riderId_type: { riderId, type: dto.type as KycType } },
      create: {
        clientId,
        riderId,
        type: dto.type as KycType,
        status: result.status,
        provider: result.provider,
        providerReference: result.providerReference,
        maskedData: result.maskedData as Prisma.InputJsonValue | undefined,
        safeFailureCode: result.safeFailureCode,
        verifiedAt: result.status === KycStatus.VERIFIED ? new Date() : null,
      },
      update: {
        status: result.status,
        provider: result.provider,
        providerReference: result.providerReference,
        maskedData: result.maskedData as Prisma.InputJsonValue | undefined,
        safeFailureCode: result.safeFailureCode,
        verifiedAt: result.status === KycStatus.VERIFIED ? new Date() : null,
      },
    });
  }

  async complete(
    clientId: string,
    riderId: string,
    kycId: string,
    dto: CompleteKycDto,
  ) {
    const kyc = await this.prisma.riderKyc.findFirst({
      where: { id: kycId, riderId, clientId },
    });
    if (!kyc) throw new NotFoundException('KYC record not found.');
    if (kyc.status !== KycStatus.PENDING)
      throw new BadRequestException('KYC record is not pending.');
    return this.prisma.riderKyc.update({
      where: { id: kyc.id },
      data: {
        status: dto.status as KycStatus,
        maskedData: dto.maskedData as Prisma.InputJsonValue | undefined,
        safeFailureCode: dto.safeFailureCode,
        verifiedAt: dto.status === 'VERIFIED' ? new Date() : null,
      },
    });
  }

  private async assertRider(clientId: string, riderId: string) {
    const rider = await this.prisma.rider.findFirst({
      where: { id: riderId, clientId, deletedAt: null },
    });
    if (!rider) throw new NotFoundException('Rider not found.');
  }
}
