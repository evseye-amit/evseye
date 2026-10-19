import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ValidationPipe } from '@nestjs/common';
import { MasterRecordStatus, WorkPartnerCategory } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateWorkPartnerDto, type UpdateWorkPartnerDto, type WorkPartnerStatus } from './dto/work-partner.dto.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { z } from 'zod';

@Injectable()
export class WorkPartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private importAdmin(actor: AuthUser, clientId?: string) {
    if (!actor.roles.includes(clientId ? 'CLIENT_ADMIN' : 'SUPER_ADMIN') || (clientId && actor.clientId !== clientId))
      throw new ForbiddenException('Administrator permission is required.');
  }

  async bulkCreate(actor: AuthUser, input: unknown, clientId?: string) {
    this.importAdmin(actor, clientId);
    const parsed = z.object({ filename: z.string().trim().min(1).max(200),
      rows: z.array(z.record(z.string(), z.string().max(1000).nullable())).min(1).max(100),
    }).strict().safeParse(input);
    if (!parsed.success) throw new BadRequestException('Provide a filename and between 1 and 100 work partner records.');
    const { filename, rows } = parsed.data;
    const failures: { row: number; code: string; message: string; record: typeof rows[number] }[] = [];
    const job = await this.prisma.auditLog.create({ data: {
      clientId: clientId ?? null, actorId: actor.id, action: 'WORK_PARTNER_BULK_IMPORT', entityType: 'WORK_PARTNER_IMPORT',
      newData: { filename, totalRows: rows.length, status: 'PROCESSING' },
    } });
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    let passedRows = 0;
    for (const [index, record] of rows.entries()) {
      try {
        const dto = await pipe.transform(record, { type: 'body', metatype: CreateWorkPartnerDto }) as CreateWorkPartnerDto;
        if (clientId) await this.createClientPartner(clientId, dto, actor.id);
        else await this.createMaster(dto, actor.id);
        passedRows++;
      } catch (error) {
        if (!(error instanceof HttpException) || error.getStatus() >= 500) {
          await this.prisma.auditLog.update({ where: { id: job.id }, data: { newData: {
            filename, totalRows: rows.length, passedRows, failedRows: failures.length, failures, status: 'INTERRUPTED',
          } } });
          throw error;
        }
        const response = error.getResponse();
        const detail = typeof response === 'object' && 'message' in response ? response.message : error.message;
        failures.push({ row: index + 2, code: record.code ?? '', message: Array.isArray(detail) ? detail.join('; ') : String(detail), record });
      }
    }
    const result = { filename, totalRows: rows.length, passedRows, failedRows: failures.length, failures,
      status: failures.length ? passedRows ? 'PARTIAL_PASS' : 'FAIL' : 'PASS' };
    await this.prisma.auditLog.update({ where: { id: job.id }, data: { newData: result } });
    return { ...result, id: job.id.toString(), createdAt: job.createdAt };
  }

  async importHistory(actor: AuthUser, clientId?: string) {
    this.importAdmin(actor, clientId);
    const jobs = await this.prisma.auditLog.findMany({
      where: { clientId: clientId ?? null, action: 'WORK_PARTNER_BULK_IMPORT', entityType: 'WORK_PARTNER_IMPORT' },
      orderBy: { createdAt: 'desc' }, take: 100,
    });
    return jobs.map((job) => {
      const data = job.newData as Record<string, unknown>;
      return { id: job.id.toString(), jobId: job.id.toString(), createdAt: job.createdAt, fileName: data.filename,
        status: data.status, totalRows: data.totalRows, passedRows: data.passedRows ?? 0, failedRows: data.failedRows ?? 0 };
    });
  }

  async importFailures(actor: AuthUser, id: string, clientId?: string) {
    this.importAdmin(actor, clientId);
    if (!/^\d{1,19}$/.test(id) || BigInt(id) > 9223372036854775807n) throw new BadRequestException('Invalid import identifier.');
    const job = await this.prisma.auditLog.findFirst({ where: {
      id: BigInt(id), clientId: clientId ?? null, action: 'WORK_PARTNER_BULK_IMPORT', entityType: 'WORK_PARTNER_IMPORT',
    } });
    if (!job) throw new NotFoundException('Work partner import not found.');
    return (job.newData as Record<string, unknown>).failures ?? [];
  }

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
      ...this.details(dto),
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
            category: master.category,
            logo: master.logo,
            workType: master.workType,
            website: master.website,
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
      ...this.details(dto),
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
      ...this.details(dto),
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

  private details(dto: CreateWorkPartnerDto | UpdateWorkPartnerDto) {
    if (dto.category !== undefined && !Object.values(WorkPartnerCategory).includes(dto.category))
      throw new BadRequestException('Select a valid work partner category.');
    if (dto.logo != null && !/^\/logos\/work-partners\/[A-Za-z0-9_-]+\.(svg|png|jpe?g|webp)$/i.test(dto.logo))
      throw new BadRequestException('Use a controlled work partner logo asset path.');
    return {
      ...(dto.category !== undefined ? { category: dto.category } : {}),
      ...(dto.logo !== undefined ? { logo: dto.logo } : {}),
      ...(dto.workType !== undefined ? { workType: dto.workType?.trim() || null } : {}),
      ...(dto.website !== undefined ? { website: dto.website?.trim() || null } : {}),
    };
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

  private auditData(row: { id?: string; code?: string; name?: string; legalName?: string; status?: string; clientId?: string; sourceMasterId?: string | null; category?: WorkPartnerCategory; logo?: string | null; workType?: string | null; website?: string | null }) {
    return {
      id: row.id,
      clientId: row.clientId,
      sourceMasterId: row.sourceMasterId,
      code: row.code,
      name: row.name,
      legalName: row.legalName,
      status: row.status,
      category: row.category,
      logo: row.logo,
      workType: row.workType,
      website: row.website,
    };
  }
}
