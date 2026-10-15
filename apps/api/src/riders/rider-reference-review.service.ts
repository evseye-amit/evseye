import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, RiderReferenceReviewStatus } from '@prisma/client';
import { normalizeIndianMobile } from '../common/phone.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RiderOnboardingConfigurationService } from './rider-onboarding-configuration.service.js';
import type { ListRiderReferencesDto } from './dto/rider-reference.dto.js';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

type Reference = {
  id: string; ownerKey: string; riderId: string | null; userId: string | null;
  riderName: string; riderMobile: string; name: string; mobile: string; relation: string;
  createdAt: Date; status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason: string | null; reviewedAt: Date | null;
  reviewedBy: { id: string; name: string } | null;
};

@Injectable()
export class RiderReferenceReviewService {
  constructor(private readonly prisma: PrismaService, private readonly configuration: RiderOnboardingConfigurationService) {}

  async list(clientId: string, query: ListRiderReferencesDto = {}) {
    const references = await this.currentReferences(this.prisma, clientId, query);
    const decisions = references.length ? await this.prisma.riderReferenceReview.findMany({
      where: { clientId, id: { in: references.map((reference) => reference.id) } },
      include: { reviewedBy: { select: { id: true, name: true } } },
    }) : [];
    const byId = new Map(decisions.map((decision) => [decision.id, decision]));
    const search = query.search?.trim().toLowerCase();
    return references.map((reference) => {
      const decision = byId.get(reference.id);
      return decision ? { ...reference, status: decision.status, rejectionReason: decision.rejectionReason,
        reviewedAt: decision.reviewedAt, reviewedBy: decision.reviewedBy } : reference;
    }).filter((reference) => (!query.status || reference.status === query.status) &&
      (!search || [reference.riderName, reference.riderMobile, reference.name, reference.mobile, reference.relation]
        .some((value) => value.toLowerCase().includes(search))));
  }

  async forRider(clientId: string, riderId: string) {
    if (!await this.prisma.rider.findFirst({ where: { id: riderId, clientId, deletedAt: null }, select: { id: true } }))
      throw new NotFoundException('Rider not found.');
    return this.list(clientId, { riderId });
  }

  async review(clientId: string, reviewerId: string, id: string, status: RiderReferenceReviewStatus, reason?: string) {
    const rejectionReason = status === 'REJECTED' ? reason?.trim() : null;
    if (status === 'REJECTED' && (!rejectionReason || rejectionReason.length > 1000))
      throw new BadRequestException('A rejection reason of 1 to 1000 characters is required.');
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Never accept a decision for details that have been replaced or removed.
        const reference = (await this.currentReferences(tx, clientId)).find((entry) => entry.id === id);
        if (!reference) throw new NotFoundException('Current rider reference not found.');
        const decision = await tx.riderReferenceReview.create({
          data: { id, clientId, ownerKey: reference.ownerKey, name: reference.name, mobile: reference.mobile,
            relation: reference.relation, status, rejectionReason, reviewedById: reviewerId },
          include: { reviewedBy: { select: { id: true, name: true } } },
        });
        return { ...reference, status: decision.status, rejectionReason: decision.rejectionReason,
          reviewedAt: decision.reviewedAt, reviewedBy: decision.reviewedBy };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code))
        throw new ConflictException('This reference has changed or has already been reviewed. Refresh and try again.');
      throw error;
    }
  }

  private async currentReferences(db: Prisma.TransactionClient, clientId: string, query: ListRiderReferencesDto = {}) {
    const effective = await this.configuration.getEffectiveConfiguration(clientId);
    const fields = effective.onboarding.steps.flatMap((step) => step.fields);
    const referenceFields = fields.filter((field) => field.featureCode === 'CAPTURE_REFERENCE' || field.fieldType === 'REFERENCE');
    const nameCode = fields.find((field) => field.storageKey === 'name')?.fieldCode ?? 'FULL_NAME';
    const [riders, progresses] = await Promise.all([
      db.rider.findMany({
        where: { clientId, deletedAt: null, ...(query.riderId ? { id: query.riderId } : {}), ...(query.userId ? { userId: query.userId } : {}) },
        select: { id: true, userId: true, name: true, mobile: true, metadata: true, createdAt: true }, orderBy: { createdAt: 'asc' },
      }),
      query.riderId ? Promise.resolve([]) : db.riderOnboardingProgress.findMany({
        where: { clientId, ...(query.userId ? { userId: query.userId } : {}), user: { clientId, deletedAt: null, role: 'RIDER', rider: null } },
        select: { userId: true, values: true, createdAt: true, user: { select: { name: true, mobile: true } } }, orderBy: { createdAt: 'asc' },
      }),
    ]);
    const result = new Map<string, Reference>();
    const add = (raw: unknown, owner: Pick<Reference, 'ownerKey' | 'riderId' | 'userId' | 'riderName' | 'riderMobile' | 'createdAt'>, fieldKey: string) => {
      if (!Array.isArray(raw)) return;
      for (const item of raw) {
        const entry = record(item);
        const name = typeof entry.name === 'string' ? entry.name.trim() : '';
        const relation = typeof entry.relation === 'string' ? entry.relation.trim() : '';
        const rawMobile = typeof entry.mobile === 'string' ? entry.mobile.trim() : '';
        if (!name || !relation || !rawMobile) continue;
        const mobile = normalizeIndianMobile(rawMobile);
        const id = createHash('sha256').update(JSON.stringify([clientId, owner.ownerKey, fieldKey, name, mobile, relation])).digest('hex');
        result.set(id, { ...owner, id, name, mobile, relation, status: 'PENDING', rejectionReason: null, reviewedAt: null, reviewedBy: null });
      }
    };
    for (const rider of riders) {
      const metadata = record(rider.metadata);
      const owner = { ownerKey: rider.userId ? `user:${rider.userId}` : `rider:${rider.id}`, riderId: rider.id,
        userId: rider.userId, riderName: rider.name, riderMobile: rider.mobile, createdAt: rider.createdAt };
      add(metadata.references, owner, 'metadata.references');
      for (const field of referenceFields) if (field.storageKey.startsWith('metadata.') && field.storageKey !== 'metadata.references')
        add(metadata[field.storageKey.slice('metadata.'.length)], owner, field.storageKey);
    }
    for (const progress of progresses) {
      const values = record(progress.values);
      const enteredName = values[nameCode] ?? values.FULL_NAME;
      const riderName = typeof enteredName === 'string' && enteredName.trim() ? enteredName.trim()
        : /^pending (rider|user)$/i.test(progress.user.name.trim()) ? 'Name not provided' : progress.user.name;
      const owner = { ownerKey: `user:${progress.userId}`, riderId: null, userId: progress.userId,
        riderName, riderMobile: progress.user.mobile, createdAt: progress.createdAt };
      add(values.RIDER_REFERENCES, owner, 'metadata.references');
      for (const field of referenceFields) if (field.fieldCode !== 'RIDER_REFERENCES')
        add(values[field.fieldCode], owner, field.storageKey || field.fieldCode);
    }
    return [...result.values()];
  }
}
