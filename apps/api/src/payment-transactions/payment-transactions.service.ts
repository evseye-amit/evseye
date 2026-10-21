import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MediaService } from '../media/media.service.js';
import { paymentPhotoTypes, type PaymentSource } from '../media/payment-photo.js';
import { DeploymentCommercialService } from '../allocations/deployment-commercial.service.js';
import type { PaymentReceiptUploadDto, PaymentTransactionsQuery } from './payment-transactions.dto.js';

type TransactionRow = { source: PaymentSource; id: string; riderId: string; riderName: string; mobile: string; amount: string; currency: string;
  status: string; reference: string | null; paymentNumber: string | null; method: string; purpose: string; createdAt: Date; submittedAt: Date | null;
  submissionVersion: number; allocationId: string | null; rejectionReason: string | null; rejectedAt: Date | null; rejectedById: string | null; verifiedAt: Date | null; verifiedById: string | null };
@Injectable()
export class PaymentTransactionsService {
  constructor(private readonly db: PrismaService, private readonly media: MediaService, private readonly commercial: DeploymentCommercialService) {}

  private union(clientId: string) {
    // Provider transactions own their financial receipt; omit the corresponding RiderPayment to avoid duplicate rows.
    return Prisma.sql`
      SELECT 'DEPLOYMENT'::text source, p.id, a."riderId", p.amount::text amount, p.currency, p.status::text status,
        p."providerReference" reference, NULL::text "paymentNumber", COALESCE(p.provider, 'MANUAL') method,
        'ALLOCATION'::text purpose, p."createdAt", p."submittedAt", p."submissionVersion", a.id "allocationId",
        p."rejectionReason", p."rejectedAt", p."rejectedById", p."verifiedAt", p."verifiedById"
      FROM "DeploymentPayment" p JOIN "MobileDeploymentWorkflow" w ON w.id=p."workflowId" AND w."clientId"=p."clientId"
      JOIN "Allocation" a ON a.id=w."allocationId" AND a."clientId"=p."clientId" WHERE p."clientId"=${clientId}
      UNION ALL
      SELECT 'COLLECTION', p.id, p."riderId", p.amount::text, p.currency, p.status, COALESCE(p."providerPaymentId",p."providerOrderId"), p."paymentNumber", p.method,
        p."collectionType", p."createdAt", NULL::timestamp, 0, NULL::text, NULL::text, NULL::timestamp, NULL::text, p."completedAt", NULL::text
      FROM "PaymentCollectionRequest" p WHERE p."clientId"=${clientId}
      UNION ALL
      SELECT 'AUTOPAY', p.id, p."riderId", p.amount::text, p.currency, p.status::text, COALESCE(p."providerReference",p."providerPaymentId"), p."debitNumber", 'AUTOPAY',
        'INVOICE', p."createdAt", NULL::timestamp, 0, NULL::text, NULL::text, NULL::timestamp, NULL::text, p."completedAt", NULL::text
      FROM "PaymentTransaction" p WHERE p."clientId"=${clientId}
      UNION ALL
      SELECT 'RECEIVED', p.id, p."riderId", p.amount::text, p.currency, p.status, p."externalReference", NULL::text, p.method,
        'RECORDED_PAYMENT', p."createdAt", NULL::timestamp, 0, NULL::text, NULL::text, NULL::timestamp, NULL::text, p."receivedAt", p."createdById"
      FROM "RiderPayment" p WHERE p."clientId"=${clientId} AND p.method <> 'DEPLOYMENT'
        AND NOT EXISTS (SELECT 1 FROM "PaymentCollectionRequest" c WHERE c."clientId"=p."clientId" AND c."riderPaymentId"=p.id)
        AND NOT EXISTS (SELECT 1 FROM "PaymentTransaction" t WHERE t."clientId"=p."clientId" AND t."riderPaymentId"=p.id)`;
  }

  private source(source: string): PaymentSource {
    if (!Object.hasOwn(paymentPhotoTypes, source)) throw new BadRequestException('Invalid payment source.');
    return source as PaymentSource;
  }
  private async riderForUser(clientId: string, userId: string) {
    const rider = await this.db.rider.findFirst({ where: { clientId, userId, deletedAt: null }, select: { id: true } });
    if (!rider) throw new NotFoundException('Rider profile not found.');
    return rider.id;
  }
  async list(clientId: string, actor: AuthUser, q: PaymentTransactionsQuery) {
    if (!actor.roles.includes(UserRole.CLIENT_ADMIN) && !actor.roles.includes(UserRole.RIDER)) throw new ForbiddenException();
    const riderId = actor.roles.includes(UserRole.CLIENT_ADMIN) ? null : await this.riderForUser(clientId, actor.id);
    if (q.from && q.to && new Date(q.from) > new Date(q.to)) throw new BadRequestException('The start date must precede the end date.');
    const search = `%${q.search?.trim() ?? ''}%`;
    const where = Prisma.sql`WHERE r."clientId"=${clientId}
      ${riderId ? Prisma.sql`AND t."riderId"=${riderId}` : Prisma.empty}
      ${q.source ? Prisma.sql`AND t.source=${q.source}` : Prisma.empty}
      ${q.status ? Prisma.sql`AND t.status=${q.status}` : Prisma.empty}
      ${q.from ? Prisma.sql`AND t."createdAt">=${new Date(q.from)}` : Prisma.empty}
      ${q.to ? Prisma.sql`AND t."createdAt"<=${new Date(q.to)}` : Prisma.empty}
      ${q.search?.trim() ? Prisma.sql`AND (r.name ILIKE ${search} OR r.mobile ILIKE ${search} OR t.reference ILIKE ${search} OR t.id ILIKE ${search} OR t."paymentNumber" ILIKE ${search})` : Prisma.empty}`;
    const base = Prisma.sql`FROM (${this.union(clientId)}) t JOIN "Rider" r ON r.id=t."riderId" ${where}`;
    const sortColumns: Record<string, Prisma.Sql> = { createdAt: Prisma.sql`t."createdAt"`, riderName: Prisma.sql`r.name`, mobile: Prisma.sql`r.mobile`, amount: Prisma.sql`t.amount::numeric`, status: Prisma.sql`t.status`, reference: Prisma.sql`COALESCE(t.reference,t."paymentNumber")`, source: Prisma.sql`t.source`, method: Prisma.sql`t.method`, purpose: Prisma.sql`t.purpose` };
    const order = sortColumns[q.sortBy] ?? sortColumns.createdAt;
    const direction = q.sortDirection === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const [items, count] = await this.db.$transaction([
      this.db.$queryRaw<TransactionRow[]>(Prisma.sql`SELECT t.*, r.name "riderName", r.mobile ${base} ORDER BY ${order} ${direction} NULLS LAST,t.source,t.id LIMIT ${q.limit} OFFSET ${(q.page-1)*q.limit}`),
      this.db.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT COUNT(*) total ${base}`),
    ]);
    const photos = items.length ? await this.db.photo.groupBy({ by: ['entityType', 'entityId'], where: { clientId, status: 'COMPLETE', OR: items.map(x => ({ entityType: paymentPhotoTypes[x.source], entityId: x.id })) }, _count: true }) : [];
    return { items: items.map(x => ({ ...x, receiptCount: photos.find(p => p.entityType === paymentPhotoTypes[x.source] && p.entityId === x.id)?._count ?? 0,
      canReview: actor.roles.includes(UserRole.CLIENT_ADMIN) && x.source === 'DEPLOYMENT' && x.status === 'SUBMITTED' })), total: Number(count[0].total), page: q.page, limit: q.limit };
  }

  async detail(clientId: string, actor: AuthUser, rawSource: string, id: string) {
    const source = this.source(rawSource);
    const rows = await this.db.$queryRaw<TransactionRow[]>(Prisma.sql`SELECT t.*, r.name "riderName",r.mobile
      FROM (${this.union(clientId)}) t JOIN "Rider" r ON r.id=t."riderId" AND r."clientId"=${clientId} WHERE t.source=${source} AND t.id=${id}`);
    const row = rows[0];
    if (!row) throw new NotFoundException('Payment transaction not found.');
    if (!actor.roles.includes(UserRole.CLIENT_ADMIN)) {
      if (actor.roles.includes(UserRole.RIDER)) {
        if (row.riderId !== await this.riderForUser(clientId, actor.id)) throw new NotFoundException('Payment transaction not found.');
      } else if (actor.roles.includes(UserRole.FLEET_MANAGER) && source === 'DEPLOYMENT') {
        const hubs = await this.db.userHub.findMany({ where: { clientId, userId: actor.id, hub: { clientId, status: 'ACTIVE', deletedAt: null } }, select: { hubId: true } });
        if (!await this.db.allocation.findFirst({ where: { clientId, id: row.allocationId!, fleet: { currentHubId: { in: hubs.map(x => x.hubId) } } }, select: { id: true } })) throw new NotFoundException('Payment transaction not found in an assigned hub.');
      } else throw new ForbiddenException();
    }
    const receipts = await this.db.photo.findMany({ where: { clientId, entityType: paymentPhotoTypes[source], entityId: id, status: 'COMPLETE' },
      select: { id: true, mimeType: true, sizeBytes: true, uploadedAt: true, uploadedById: true }, orderBy: { createdAt: 'asc' } });
    const history = source === 'DEPLOYMENT' ? await this.db.auditLog.findMany({ where: { clientId, entityType: 'DeploymentPayment', entityId: id,
      action: { in: ['PAYMENT_SUBMITTED', 'PAYMENT_REJECTED', 'PAYMENT_APPROVED'] } }, select: { id: true, action: true, actorId: true, newData: true, createdAt: true }, orderBy: { createdAt: 'asc' } }) : [];
    const reviewers = history.length ? await this.db.user.findMany({ where: { clientId, id: { in: [...new Set(history.flatMap(x => x.actorId ? [x.actorId] : []))] } }, select: { id: true, name: true } }) : [];
    return { ...row, receipts, history: history.map(x => ({ ...x, id: x.id.toString(), actorName: reviewers.find(u => u.id === x.actorId)?.name ?? 'System' })),
      canReview: actor.roles.includes(UserRole.CLIENT_ADMIN) && source === 'DEPLOYMENT' && row.status === 'SUBMITTED' };
  }
  async approve(clientId: string, actor: AuthUser, source: string, id: string, version: number) {
    if (!actor.roles.includes(UserRole.CLIENT_ADMIN)) throw new ForbiddenException();
    const row = await this.detail(clientId, actor, source, id);
    if (row.source !== 'DEPLOYMENT') throw new BadRequestException('Provider-confirmed payments use automatic verification.');
    await this.commercial.verifyPayment(clientId, actor.id, row.allocationId!, version);
    return this.detail(clientId, actor, source, id);
  }
  async reject(clientId: string, actor: AuthUser, source: string, id: string, version: number, reason: string) {
    if (!actor.roles.includes(UserRole.CLIENT_ADMIN)) throw new ForbiddenException();
    const row = await this.detail(clientId, actor, source, id);
    if (row.source !== 'DEPLOYMENT') throw new BadRequestException('Only manually submitted allocation payments can be rejected.');
    await this.commercial.rejectPayment(clientId, actor.id, row.allocationId!, reason, version);
    return this.detail(clientId, actor, source, id);
  }
  async upload(clientId: string, actor: AuthUser, source: string, id: string, dto: PaymentReceiptUploadDto) {
    if (!actor.roles.includes(UserRole.RIDER)) throw new ForbiddenException('Only the rider can upload their receipt.');
    const row = await this.detail(clientId, actor, source, id);
    if (row.riderId !== await this.riderForUser(clientId, actor.id)) throw new NotFoundException('Payment transaction not found.');
    return this.media.createPaymentUploadIntent(clientId, actor.id, paymentPhotoTypes[row.source], id, dto);
  }
  async complete(clientId: string, actor: AuthUser, source: string, id: string, photoId: string) {
    if (!actor.roles.includes(UserRole.RIDER)) throw new ForbiddenException();
    const row = await this.detail(clientId, actor, source, id);
    if (row.riderId !== await this.riderForUser(clientId, actor.id)) throw new NotFoundException('Payment transaction not found.');
    if (row.source === 'DEPLOYMENT') {
      return this.db.$transaction(async tx => {
        // Match the approval lock so receipt publication and review versions agree.
        await tx.$queryRaw`SELECT id FROM "Allocation" WHERE id=${row.allocationId} AND "clientId"=${clientId} FOR UPDATE`;
        const before = await tx.photo.findFirst({ where: { id: photoId, clientId, entityType: 'PAYMENT_DEPLOYMENT', entityId: id, uploadedById: actor.id } });
        if (!before) throw new NotFoundException('Payment receipt not found.');
        const photo = await this.media.completePayment(clientId, 'PAYMENT_DEPLOYMENT', id, photoId, actor.id, tx);
        if (before.status !== 'COMPLETE') {
          await tx.deploymentPayment.updateMany({ where: { id, clientId, status: 'SUBMITTED' }, data: { submissionVersion: { increment: 1 } } });
          await tx.auditLog.create({ data: { clientId, actorId: actor.id, action: 'PAYMENT_RECEIPT_UPLOADED', entityType: 'Photo', entityId: photo.id,
            newData: { source: row.source, paymentId: id } } });
        }
        return { id: photo.id, status: photo.status, uploadedAt: photo.uploadedAt };
      }, { timeout: 30000 });
    }
    const photo = await this.media.completePayment(clientId, paymentPhotoTypes[row.source], id, photoId, actor.id);
    await this.db.auditLog.create({ data: { clientId, actorId: actor.id, action: 'PAYMENT_RECEIPT_UPLOADED', entityType: 'Photo', entityId: photo.id,
      newData: { source: row.source, paymentId: id } } });
    return { id: photo.id, status: photo.status, uploadedAt: photo.uploadedAt };
  }
  async receiptContent(clientId: string, actor: AuthUser, source: string, id: string, photoId: string) {
    const row = await this.detail(clientId, actor, source, id);
    return this.media.paymentContent(clientId, paymentPhotoTypes[row.source], id, photoId);
  }
  async download(clientId: string, actor: AuthUser, source: string, id: string, photoId: string) {
    const row = await this.detail(clientId, actor, source, id);
    return this.media.paymentDownloadUrl(clientId, paymentPhotoTypes[row.source], id, photoId);
  }
}
