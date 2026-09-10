import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  liveness() {
    return {
      data: { status: 'ok', service: 'evs-eye-api' },
    };
  }

  async readiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ready' as const,
        data: { status: 'ready', service: 'evs-eye-api', database: 'ok' },
      };
    } catch {
      return {
        status: 'not_ready' as const,
        data: { status: 'not_ready', service: 'evs-eye-api', database: 'unavailable' },
      };
    }
  }
}
