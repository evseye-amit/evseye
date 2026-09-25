import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ReferralAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async requireFeature(clientId: string) {
    const now = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const subscription = await this.prisma.clientSubscription.findFirst({
      where: {
        clientId, status: 'ACTIVE', startDate: { lte: now },
        OR: [{ endDate: null }, { endDate: { gte: now } }],
        package: { isActive: true, features: { some: { isIncluded: true, feature: { code: 'REFER_AND_EARN', isActive: true } } } },
      },
      select: { id: true, packageId: true },
      orderBy: { startDate: 'desc' },
    });
    if (!subscription) throw new ForbiddenException({ code: 'REFERRAL_FEATURE_NOT_ENABLED', message: 'Refer & Earn is not enabled in the active client package.' });
    return subscription;
  }

  async requireRider(clientId: string, userId: string) {
    const rider = await this.prisma.rider.findFirst({
      where: { clientId, userId, deletedAt: null },
      select: { id: true, name: true, mobile: true, status: true },
    });
    if (!rider) throw new NotFoundException({ code: 'REFERRAL_NOT_ELIGIBLE', message: 'A Rider profile is required.' });
    return rider;
  }
}
