import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateHubDto } from './dto/create-hub.dto.js';
import type { CreateZoneDto } from './dto/create-zone.dto.js';

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}
  listZones(clientId: string) { return this.prisma.zone.findMany({ where: { clientId }, orderBy: { name: 'asc' } }); }
  async createZone(clientId: string, dto: CreateZoneDto) {
    try { return await this.prisma.zone.create({ data: { ...dto, clientId } }); }
    catch (error) { if (this.unique(error)) throw new ConflictException('Zone code already exists.'); throw error; }
  }
  listHubs(clientId: string) { return this.prisma.hub.findMany({ where: { clientId }, include: { zone: true }, orderBy: { name: 'asc' } }); }
  async createHub(clientId: string, dto: CreateHubDto) {
    const zone = await this.prisma.zone.findFirst({ where: { id: dto.zoneId, clientId } });
    if (!zone) throw new NotFoundException('Zone not found.');
    try { return await this.prisma.hub.create({ data: { ...dto, clientId } }); }
    catch (error) { if (this.unique(error)) throw new ConflictException('Hub code already exists.'); throw error; }
  }
  private unique(error: unknown) { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'; }
}
