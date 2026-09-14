import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateHubDto } from './dto/create-hub.dto.js';

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}
  listHubs(clientId: string) { return this.prisma.hub.findMany({ where: { clientId }, orderBy: { name: 'asc' } }); }
  async createHub(clientId: string, dto: CreateHubDto) {
    try { return await this.prisma.hub.create({ data: { ...dto, clientId } }); }
    catch (error) { if (this.unique(error)) throw new ConflictException('Hub code already exists.'); throw error; }
  }
  private unique(error: unknown) { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'; }
}
