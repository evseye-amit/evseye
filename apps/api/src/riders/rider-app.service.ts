import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { normalizeIndianMobile } from '../common/phone.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RiderOnboardingConfigurationService } from './rider-onboarding-configuration.service.js';

@Injectable()
export class RiderAppService {
  constructor(private readonly prisma: PrismaService, private readonly configuration: RiderOnboardingConfigurationService) {}

  async enroll(companyCode: string, phone: string) {
    const client = await this.prisma.client.findFirst({ where: { companyCode, isActive: true, status: 'ACTIVE' }, select: { id: true } });
    if (!client) throw new BadRequestException('Client workspace is unavailable.');
    const mobile = normalizeIndianMobile(phone);
    const existing = await this.prisma.user.findFirst({ where: { clientId: client.id, mobile } });
    if (existing && existing.role !== UserRole.RIDER) throw new ConflictException('This mobile number is already assigned to another role.');
    const user = existing ?? await this.prisma.user.create({ data: { clientId: client.id, mobile, name: 'Pending Rider', role: UserRole.RIDER } });
    const configuration = await this.configuration.getEffectiveConfiguration(client.id);
    await this.prisma.riderOnboardingProgress.upsert({ where: { userId: user.id }, create: { clientId: client.id, userId: user.id, packageId: configuration.package.id, currentStepId: configuration.onboarding.steps[0]?.stepId }, update: {} });
    return { clientId: client.id, userId: user.id, phone: mobile };
  }

  async onboarding(clientId: string, userId: string) {
    const configuration = await this.configuration.getEffectiveConfiguration(clientId);
    const progress = await this.prisma.riderOnboardingProgress.upsert({ where: { userId }, create: { clientId, userId, packageId: configuration.package.id, currentStepId: configuration.onboarding.steps[0]?.stepId }, update: { packageId: configuration.package.id } });
    const completed = new Set((progress.completedStepIds as string[]) ?? []);
    const skipped = new Set((progress.skippedStepIds as string[]) ?? []);
    const next = configuration.onboarding.steps.find((step) => !completed.has(step.stepId) && !skipped.has(step.stepId)) ?? null;
    return { ...configuration, progress: { currentStepId: next?.stepId ?? null, completedStepIds: [...completed], skippedStepIds: [...skipped], values: progress.values, completed: Boolean(progress.completedAt) } };
  }

  async saveStep(clientId: string, userId: string, stepId: string, values: Record<string, unknown>, skip = false) {
    const effective = await this.configuration.getEffectiveConfiguration(clientId);
    const step = effective.onboarding.steps.find((item) => item.stepId === stepId);
    if (!step) throw new BadRequestException('This onboarding step is not available in the active package.');
    const allowed = new Set(step.fields.filter((field) => field.fieldCode).map((field) => field.fieldCode));
    for (const code of Object.keys(values)) if (!allowed.has(code)) throw new BadRequestException(`${code} is not available in this onboarding step.`);
    if (!skip) for (const field of step.fields) if (field.required && field.fieldCode && !values[field.fieldCode]) throw new BadRequestException(`${field.fieldCode} is required.`);
    const current = await this.prisma.riderOnboardingProgress.findUnique({ where: { userId } });
    if (!current) throw new BadRequestException('Rider onboarding has not been started.');
    const completed = new Set((current.completedStepIds as string[]) ?? []); const skipped = new Set((current.skippedStepIds as string[]) ?? []);
    skip ? skipped.add(stepId) : completed.add(stepId);
    const merged = { ...((current.values as Record<string, unknown>) ?? {}), ...values };
    const allFinished = effective.onboarding.steps.every((item) => completed.has(item.stepId) || skipped.has(item.stepId));
    await this.prisma.$transaction(async (tx) => {
      await tx.riderOnboardingProgress.update({ where: { userId }, data: { values: merged as Prisma.InputJsonValue, completedStepIds: [...completed], skippedStepIds: [...skipped], ...(allFinished ? { completedAt: new Date() } : {}) } });
      if (allFinished && !(await tx.rider.findUnique({ where: { userId } }))) {
        const data: Record<string, unknown> = { clientId, userId, status: 'ACTIVE', name: String(merged.FULL_NAME ?? 'Rider'), mobile: String(merged.MOBILE_NUMBER ?? '') };
        for (const field of effective.onboarding.steps.flatMap((item) => item.fields)) {
          if (!field.fieldCode || !field.storageKey || merged[field.fieldCode] === undefined) continue;
          if (field.storageKey === 'name' || field.storageKey === 'mobile') continue;
          if (!field.storageKey.startsWith('metadata.')) data[field.storageKey] = merged[field.fieldCode];
        }
        await tx.rider.create({ data: data as never });
        await tx.user.update({ where: { id: userId }, data: { name: String(merged.FULL_NAME ?? 'Rider') } });
      }
    });
    return this.onboarding(clientId, userId);
  }
}
