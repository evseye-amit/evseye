import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateFleetDto } from './dto/create-fleet.dto.js';
import type { ListFleetsDto } from './dto/list-fleets.dto.js';
import { FleetStatusPolicy } from './fleet-status.policy.js';

@Injectable()
export class FleetsService {
  constructor(private readonly prisma: PrismaService, private readonly statusPolicy: FleetStatusPolicy) {}
  async create(tenantId: string, dto: CreateFleetDto) {
    if (dto.hubId && !await this.prisma.hub.findFirst({ where: { id: dto.hubId, tenantId } })) throw new NotFoundException('Hub not found.');
    try {
      return await this.prisma.fleet.create({ data: { ...dto, tenantId, registrationDate: dto.registrationDate ? new Date(dto.registrationDate) : undefined, insuranceStartDate: dto.insuranceStartDate ? new Date(dto.insuranceStartDate) : undefined, insuranceEndDate: dto.insuranceEndDate ? new Date(dto.insuranceEndDate) : undefined, fitnessRenewalDate: dto.fitnessRenewalDate ? new Date(dto.fitnessRenewalDate) : undefined } });
    } catch (error) { if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') throw new ConflictException('Vehicle number or chassis number already exists in this tenant.'); throw error; }
  }
  async list(tenantId: string, query: ListFleetsDto) {
    const where = { tenantId, deletedAt: null, ...(query.status ? { status: query.status as import('@prisma/client').FleetStatus } : {}), ...(query.search ? { OR: [{ vehicleNumber: { contains: query.search, mode: 'insensitive' as const } }, { chassisNumber: { contains: query.search, mode: 'insensitive' as const } }, { oem: { contains: query.search, mode: 'insensitive' as const } }] } : {}) };
    const [items, total] = await this.prisma.$transaction([this.prisma.fleet.findMany({ where, include: { hub: true }, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }), this.prisma.fleet.count({ where })]);
    return { items, meta: { page: query.page, pageSize: query.pageSize, total } };
  }
  async get(tenantId: string, id: string) { const fleet = await this.prisma.fleet.findFirst({ where: { id, tenantId, deletedAt: null }, include: { hub: true, batteries: true, controllers: true } }); if (!fleet) throw new NotFoundException('Fleet not found.'); return fleet; }
  async currentState(tenantId:string,id:string){await this.get(tenantId,id);return this.prisma.vehicleCurrentState.findFirst({where:{tenantId,fleetId:id}});}
  async changeStatus(tenantId: string, id: string, status: Parameters<FleetStatusPolicy['assertTransition']>[1]) { const fleet = await this.get(tenantId, id); this.statusPolicy.assertTransition(fleet.status, status); return this.prisma.fleet.update({ where: { id }, data: { status } }); }
}
