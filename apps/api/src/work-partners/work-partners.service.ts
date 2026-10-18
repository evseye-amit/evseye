import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MasterRecordStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateWorkPartnerDto, UpdateWorkPartnerDto, WorkPartnerStatus } from './dto/work-partner.dto.js';

@Injectable()
export class WorkPartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listMasters() {
    return this.prisma.workPartnerMaster.findMany({ orderBy: [{ name: 'asc' }, { code: 'asc' }] });
  }

  listClientPartners(clientId: string) {
    return this.prisma.clientWorkPartner.findMany({
      where: { clientId },
      orderBy: [{ name: 'asc' }, { code: 'asc' }],
    });
  }

  async listClientPartnersForPlatform(clientId: string) {
    await this.requireClient(clientId);
    return this.listClientPartners(clientId);
  }

  listActiveMasters() {
    return this.prisma.workPartnerMaster.findMany({
      where: { status: MasterRecordStatus.ACTIVE },
      orderBy: [{ name: 'asc' }, { code: 'asc' }],
    });
  }

  listActiveClientPartners(clientId: string) {
    return this.prisma.clientWorkPartner.findMany({
      where: { clientId, status: MasterRecordStatus.ACTIVE },
      orderBy: [{ name: 'asc' }, { code: 'asc' }],
    });
  }

  async createMaster(dto: CreateWorkPartnerDto, actorId: string) {
    const data = this.masterCreateData(dto);
    let row;
    try {
      row = await this.prisma.workPartnerMaster.create({ data });
    } catch (error) {
      this.throwDuplicate(error, 'Work partner code already exists.');
      throw error;
    }
    await this.audit.record({
      actorId,
      action: 'WORK_PARTNER_MASTER_CREATED',
      entityType: 'WorkPartnerMaster',
      entityId: row.id,
      newData: this.auditData(row),
    });
    return row;
  }

  async updateMaster(id: string, dto: UpdateWorkPartnerDto, actorId: string) {
    const current = await this.prisma.workPartnerMaster.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Work partner not found.');
    const data = this.masterUpdateData(dto);
    let row;
    try {
      row = await this.prisma.workPartnerMaster.update({ where: { id }, data });
    } catch (error) {
      this.throwDuplicate(error, 'Work partner code already exists.');
      throw error;
    }
    await this.audit.record({
      actorId,
      action: 'WORK_PARTNER_MASTER_UPDATED',
      entityType: 'WorkPartnerMaster',
      entityId: row.id,
      previousData: this.auditData(current),
      newData: this.auditData(row),
    });
    return row;
  }

  async createClientPartner(clientId: string, dto: CreateWorkPartnerDto, actorId: string) {
    const data = {
      clientId,
      sourceMasterId: null,
      code: this.normalizeCode(dto.code),
      name: this.requiredText(dto.name, 'Work partner name', 150),
      legalName: this.requiredText(dto.legalName, 'Work partner legal name', 160),
      status: this.normalizeStatus(dto.status),
    };
    let row;
    try {
      row = await this.prisma.clientWorkPartner.create({ data });
    } catch (error) {
      this.throwDuplicate(error, 'Work partner code already exists for this client.');
      throw error;
    }
    await this.audit.record({
      clientId,
      actorId,
      action: 'CLIENT_WORK_PARTNER_CREATED',
      entityType: 'ClientWorkPartner',
      entityId: row.id,
      newData: this.auditData(row),
    });
    return row;
  }

  async updateClientPartner(clientId: string, id: string, dto: UpdateWorkPartnerDto, actorId: string) {
    const current = await this.prisma.clientWorkPartner.findFirst({ where: { id, clientId } });
    if (!current) throw new NotFoundException('Work partner not found.');
    const data = this.masterUpdateData(dto);
    let row;
    try {
      row = await this.prisma.clientWorkPartner.update({ where: { id }, data });
    } catch (error) {
      this.throwDuplicate(error, 'Work partner code already exists for this client.');
      throw error;
    }
    await this.audit.record({
      clientId,
      actorId,
      action: 'CLIENT_WORK_PARTNER_UPDATED',
      entityType: 'ClientWorkPartner',
      entityId: row.id,
      previousData: this.auditData(current),
      newData: this.auditData(row),
    });
    return row;
  }

  async copyMasterToClient(clientId: string, masterId: string, actorId: string) {
    await this.requireClient(clientId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const master = await tx.workPartnerMaster.findUnique({ where: { id: masterId } });
        if (!master) throw new NotFoundException('Work partner not found.');
        if (master.status !== MasterRecordStatus.ACTIVE) {
          throw new ConflictException('Inactive work partner cannot be copied.');
        }
        const row = await tx.clientWorkPartner.create({
          data: {
            clientId,
            sourceMasterId: master.id,
            code: master.code,
            name: master.name,
            legalName: master.legalName,
            status: master.status,
          },
        });
        await tx.auditLog.create({
          data: {
            clientId,
            actorId,
            action: 'CLIENT_WORK_PARTNER_COPIED',
            entityType: 'ClientWorkPartner',
            entityId: row.id,
            newData: this.auditData(row),
          },
        });
        return row;
      });
    } catch (error) {
      this.throwDuplicate(error, 'Work partner code already exists for this client.');
      throw error;
    }
  }

  private masterCreateData(dto: CreateWorkPartnerDto) {
    return {
      code: this.normalizeCode(dto.code),
      name: this.requiredText(dto.name, 'Work partner name', 150),
      legalName: this.requiredText(dto.legalName, 'Work partner legal name', 160),
      status: this.normalizeStatus(dto.status),
    };
  }

  private async requireClient(clientId: string) {
    const client = await this.prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
    if (!client) throw new NotFoundException('Client not found.');
    return client;
  }

  private masterUpdateData(dto: UpdateWorkPartnerDto) {
    return {
      ...(dto.name !== undefined ? { name: this.requiredText(dto.name, 'Work partner name', 150) } : {}),
      ...(dto.legalName !== undefined ? { legalName: this.requiredText(dto.legalName, 'Work partner legal name', 160) } : {}),
      ...(dto.status !== undefined ? { status: this.normalizeStatus(dto.status) } : {}),
    };
  }

  private normalizeCode(value: string) {
    const code = value.trim().toUpperCase();
    if (!code || code.length > 50 || !/^[A-Z0-9_-]+$/.test(code)) {
      throw new BadRequestException('Work partner code must contain only letters, numbers, underscores, or hyphens.');
    }
    return code;
  }

  private requiredText(value: string, label: string, maxLength: number) {
    const text = value.trim();
    if (!text) throw new BadRequestException(`${label} is required.`);
    if (text.length > maxLength) throw new BadRequestException(`${label} must be at most ${maxLength} characters.`);
    return text;
  }

  private normalizeStatus(status?: WorkPartnerStatus) {
    if (status === undefined) return MasterRecordStatus.ACTIVE;
    if (status !== MasterRecordStatus.ACTIVE && status !== MasterRecordStatus.INACTIVE) {
      throw new BadRequestException('Work partner status must be ACTIVE or INACTIVE.');
    }
    return status;
  }

  private throwDuplicate(error: unknown, message: string): void {
    if (this.isP2002(error)) throw new ConflictException(message);
  }

  private isP2002(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }

  private auditData(row: { id?: string; code?: string; name?: string; legalName?: string; status?: string; clientId?: string; sourceMasterId?: string | null }) {
    return {
      id: row.id,
      clientId: row.clientId,
      sourceMasterId: row.sourceMasterId,
      code: row.code,
      name: row.name,
      legalName: row.legalName,
      status: row.status,
    };
  }
}
