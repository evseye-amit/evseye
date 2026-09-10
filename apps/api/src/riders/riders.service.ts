import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { RiderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateRiderDto } from './dto/create-rider.dto.js';
import type { ListRidersDto } from './dto/list-riders.dto.js';
import type { UpdateRiderDto } from './dto/update-rider.dto.js';

@Injectable()
export class RidersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateRiderDto) {
    try {
      return await this.prisma.rider.create({ data: { ...dto, tenantId } });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('A rider with this mobile number already exists in this tenant.');
      }
      throw error;
    }
  }

  async list(tenantId: string, query: ListRidersDto) {
    const where = {
      tenantId,
      deletedAt: null,
      ...(query.status ? { status: query.status as RiderStatus } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { mobile: { contains: query.search } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.rider.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.rider.count({ where }),
    ]);

    return { items, meta: { page: query.page, pageSize: query.pageSize, total } };
  }

  async getById(tenantId: string, id: string) {
    const rider = await this.prisma.rider.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!rider) {
      throw new NotFoundException('Rider not found.');
    }
    return rider;
  }

  async update(tenantId: string, id: string, dto: UpdateRiderDto) {
    await this.getById(tenantId, id);
    try {
      return await this.prisma.rider.update({ where: { id }, data: dto });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('A rider with this mobile number already exists in this tenant.');
      }
      throw error;
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}
