import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateHubDto } from './dto/create-hub.dto.js';
import type { CreateZoneDto } from './dto/create-zone.dto.js';

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}
  listZones(tenantId: string) { return this.prisma.zone.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }); }
  async createZone(tenantId: string, dto: CreateZoneDto) {
    try { return await this.prisma.zone.create({ data: { ...dto, tenantId } }); }
    catch (error) { if (this.unique(error)) throw new ConflictException('Zone code already exists.'); throw error; }
  }
  listHubs(tenantId: string) { return this.prisma.hub.findMany({ where: { tenantId }, include: { zone: true }, orderBy: { name: 'asc' } }); }
  async createHub(tenantId: string, dto: CreateHubDto) {
    const zone = await this.prisma.zone.findFirst({ where: { id: dto.zoneId, tenantId } });
    if (!zone) throw new NotFoundException('Zone not found.');
    try { return await this.prisma.hub.create({ data: { ...dto, tenantId } }); }
    catch (error) { if (this.unique(error)) throw new ConflictException('Hub code already exists.'); throw error; }
  }
  private unique(error: unknown) { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'; }
}
