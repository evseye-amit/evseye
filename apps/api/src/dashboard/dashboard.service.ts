import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Environment } from '../config/environment.js';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async summary(tenantId: string) {
    const cutoff = new Date(
      Date.now() -
        this.config.getOrThrow('IOT_OFFLINE_THRESHOLD_SECONDS') * 1000,
    );
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [
      fleet,
      riders,
      kyc,
      active,
      allocationsToday,
      deallocationsToday,
      online,
      seen,
    ] = await Promise.all([
      this.prisma.fleet.groupBy({
        by: ['status'],
        where: { tenantId, deletedAt: null },
        _count: true,
      }),
      this.prisma.rider.groupBy({
        by: ['status'],
        where: { tenantId, deletedAt: null },
        _count: true,
      }),
      this.prisma.riderKyc.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: true,
      }),
      this.prisma.allocation.count({ where: { tenantId, status: 'ACTIVE' } }),
      this.prisma.allocation.count({
        where: { tenantId, allocatedAt: { gte: today } },
      }),
      this.prisma.allocation.count({
        where: { tenantId, deallocatedAt: { gte: today } },
      }),
      this.prisma.vehicleCurrentState.count({
        where: { tenantId, lastHeartbeat: { gte: cutoff } },
      }),
      this.prisma.vehicleCurrentState.count({ where: { tenantId } }),
    ]);

    return {
      fleet: Object.fromEntries(
        fleet.map((item) => [item.status, item._count]),
      ),
      riders: Object.fromEntries(
        riders.map((item) => [item.status, item._count]),
      ),
      kyc: Object.fromEntries(kyc.map((item) => [item.status, item._count])),
      operations: {
        allocationsToday,
        deallocationsToday,
        activeAllocations: active,
      },
      iot: { online, offline: seen - online },
    };
  }
}
