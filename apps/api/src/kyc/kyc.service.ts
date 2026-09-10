import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { KycStatus, KycType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CompleteKycDto } from './dto/complete-kyc.dto.js';
import type { StartKycDto } from './dto/start-kyc.dto.js';

@Injectable()
export class KycService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, riderId: string) {
    await this.assertRider(tenantId, riderId);
    return this.prisma.riderKyc.findMany({ where: { tenantId, riderId }, orderBy: { type: 'asc' } });
  }

  async start(tenantId: string, riderId: string, dto: StartKycDto) {
    await this.assertRider(tenantId, riderId);
    const existing = await this.prisma.riderKyc.findUnique({ where: { riderId_type: { riderId, type: dto.type as KycType } } });
    if (existing?.status === KycStatus.PENDING || existing?.status === KycStatus.VERIFIED) {
      throw new BadRequestException('KYC verification is already active or complete.');
    }
    return this.prisma.riderKyc.upsert({
      where: { riderId_type: { riderId, type: dto.type as KycType } },
      create: { tenantId, riderId, type: dto.type as KycType, status: KycStatus.PENDING, provider: 'sandbox' },
      update: { status: KycStatus.PENDING, provider: 'sandbox', safeFailureCode: null },
    });
  }

  async complete(tenantId: string, riderId: string, kycId: string, dto: CompleteKycDto) {
    const kyc = await this.prisma.riderKyc.findFirst({ where: { id: kycId, riderId, tenantId } });
    if (!kyc) throw new NotFoundException('KYC record not found.');
    if (kyc.status !== KycStatus.PENDING) throw new BadRequestException('KYC record is not pending.');
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

  private async assertRider(tenantId: string, riderId: string) {
    const rider = await this.prisma.rider.findFirst({ where: { id: riderId, tenantId, deletedAt: null } });
    if (!rider) throw new NotFoundException('Rider not found.');
  }
}
