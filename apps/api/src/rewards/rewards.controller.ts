import { BadRequestException, Body, Controller, Get, Headers, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { ClientContextService } from '../auth/client-context.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { RewardQualificationService } from './reward-qualification.service.js';
import { RewardPostingService } from './reward-posting.service.js';
import { RewardService } from './reward.service.js';

const positiveMoney = (value: string) => {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(value) || new Prisma.Decimal(value).lte(0)) throw new BadRequestException('REWARD_AMOUNT_INVALID');
  return new Prisma.Decimal(value);
};

@Controller('rider-app/wallet/rewards')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.RIDER)
export class RiderRewardController {
  constructor(private readonly prisma: PrismaService, private readonly wallet: WalletService, private readonly context: ClientContextService) {}
  private async own(user: AuthUser) { return this.wallet.riderWallet(this.context.requireClientId(user), user.id); }
  @Get() async list(@CurrentUser() user: AuthUser) {
    const wallet = await this.own(user);
    const items = await this.prisma.rewardClaim.findMany({ where: { clientId: wallet.clientId, riderId: wallet.riderId }, include: { program: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
    return { data: items.map(item => ({ id: item.id, title: item.program.name, source: item.sourceType, amount: item.calculatedAmount.toFixed(2), status: item.status,
      earnedAt: item.earnedAt, creditedAt: item.creditedAt, expiresAt: item.expiresAt })) };
  }
  @Get('summary') async summary(@CurrentUser() user: AuthUser) {
    const wallet = await this.own(user);
    const claims = await this.prisma.rewardClaim.findMany({ where: { clientId: wallet.clientId, riderId: wallet.riderId }, select: { status: true, creditedAmount: true } });
    const lots = await this.prisma.rewardLot.findMany({ where: { clientId: wallet.clientId, riderId: wallet.riderId, status: 'AVAILABLE', expiresAt: { gt: new Date(), lte: new Date(Date.now() + 7 * 86400000) } }, select: { remainingAmount: true } });
    const earned = claims.reduce((sum, item) => sum.plus(item.creditedAmount), new Prisma.Decimal(0));
    const expiring = lots.reduce((sum, item) => sum.plus(item.remainingAmount), new Prisma.Decimal(0));
    const balance = await this.wallet.balance(wallet.clientId, wallet.id);
    return { data: { earned: earned.toFixed(2), available: balance.rewards.availableBalance, usedOrExpired: Prisma.Decimal.max(earned.minus(balance.rewards.availableBalance), 0).toFixed(2), expiringWithinSevenDays: expiring.toFixed(2) } };
  }
  @Get(':id') async detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const wallet = await this.own(user);
    const item = await this.prisma.rewardClaim.findFirst({ where: { id, clientId: wallet.clientId, riderId: wallet.riderId }, include: { program: { select: { name: true } } } });
    if (!item) throw new NotFoundException('REWARD_CLAIM_NOT_FOUND');
    return { data: { id: item.id, title: item.program.name, source: item.sourceType, amount: item.calculatedAmount.toFixed(2), status: item.status,
      earnedAt: item.earnedAt, creditedAt: item.creditedAt, expiresAt: item.expiresAt } };
  }
}

@Controller('client/rewards')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN)
export class ClientRewardController {
  constructor(private readonly prisma: PrismaService, private readonly context: ClientContextService,
    private readonly qualification: RewardQualificationService, private readonly posting: RewardPostingService, private readonly rewards: RewardService) {}
  private client(user: AuthUser) { return this.context.requireClientId(user); }

  @Get('programs') async programs(@CurrentUser() user: AuthUser) {
    return { data: await this.prisma.rewardProgram.findMany({ where: { clientId: this.client(user) }, include: { rules: true }, orderBy: { createdAt: 'desc' }, take: 100 }) };
  }
  @Get('programs/:id/budget') async budget(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const clientId = this.client(user);
    const program = await this.prisma.rewardProgram.findFirst({ where: { id, clientId } });
    if (!program) throw new NotFoundException('REWARD_PROGRAM_NOT_FOUND');
    const claims = await this.prisma.rewardClaim.findMany({ where: { clientId, programId: id, status: { notIn: ['REJECTED', 'CANCELLED'] } }, select: { status: true, calculatedAmount: true, unrecoveredAmount: true } });
    const committed = claims.reduce((sum, claim) => sum.plus(claim.status === 'REVERSED' ? claim.unrecoveredAmount : claim.calculatedAmount), new Prisma.Decimal(0));
    const credited = claims.filter(claim => ['CREDITED', 'EXPIRED'].includes(claim.status)).reduce((sum, claim) => sum.plus(claim.calculatedAmount), new Prisma.Decimal(0));
    return { data: { programId: id, totalBudget: program.totalBudget?.toFixed(2) ?? null, committed: committed.toFixed(2), credited: credited.toFixed(2),
      remaining: program.totalBudget ? Prisma.Decimal.max(program.totalBudget.minus(committed), 0).toFixed(2) : null, currency: program.currency } };
  }
  @Post('programs') async createProgram(@CurrentUser() user: AuthUser, @Body() body: { code: string; name: string; type: string; validFrom: string; validUntil?: string; totalBudget?: string }) {
    const clientId = this.client(user);
    if (!body || !/^[A-Z0-9_-]{3,60}$/.test(body.code ?? '') || !body.name?.trim() || !['SELF_SUBMISSION', 'MANUAL'].includes(body.type)) throw new BadRequestException('REWARD_PROGRAM_INVALID');
    const from = new Date(body.validFrom), until = body.validUntil ? new Date(body.validUntil) : null;
    if (!Number.isFinite(from.getTime()) || (until && (!Number.isFinite(until.getTime()) || until <= from))) throw new BadRequestException('REWARD_DATES_INVALID');
    const budget = body.totalBudget ? positiveMoney(body.totalBudget) : null;
    return this.prisma.$transaction(async tx => {
      const program = await tx.rewardProgram.create({ data: { clientId, code: body.code, name: body.name.trim(), type: body.type,
        validFrom: from, validUntil: until, totalBudget: budget, createdById: user.id } });
      await tx.auditLog.create({ data: { clientId, actorId: user.id, action: 'REWARD_PROGRAM_CREATED', entityType: 'RewardProgram', entityId: program.id } });
      return { data: program };
    });
  }
  @Post('programs/:id/rules') async createRule(@CurrentUser() user: AuthUser, @Param('id') programId: string,
    @Body() body: { code: string; name: string; rewardValue: string; approvalMode: string; expiryDays?: number; expiryAt?: string; monthlyCountCap?: number; monthlyAmountCap?: string }) {
    const clientId = this.client(user);
    if (!body || !/^[A-Z0-9_-]{3,60}$/.test(body.code ?? '') || !body.name?.trim() || !['AUTO', 'MANUAL_APPROVAL'].includes(body.approvalMode) ||
      (body.expiryDays != null && (!Number.isInteger(body.expiryDays) || body.expiryDays < 1)) ||
      (body.expiryAt != null && (body.expiryDays != null || !Number.isFinite(new Date(body.expiryAt).getTime()) || new Date(body.expiryAt) <= new Date())) ||
      (body.monthlyCountCap != null && (!Number.isInteger(body.monthlyCountCap) || body.monthlyCountCap < 1))) throw new BadRequestException('REWARD_RULE_INVALID');
    const value = positiveMoney(body.rewardValue);
    const monthlyAmountCap = body.monthlyAmountCap ? positiveMoney(body.monthlyAmountCap) : null;
    return this.prisma.$transaction(async tx => {
      const program = await tx.rewardProgram.findFirst({ where: { id: programId, clientId, status: 'DRAFT' } });
      if (!program) throw new NotFoundException('REWARD_PROGRAM_DRAFT_NOT_FOUND');
      const rule = await tx.rewardRule.create({ data: { clientId, programId, code: body.code, name: body.name.trim(),
        triggerType: program.type === 'MANUAL' ? 'MANUAL' : 'SELF_SUBMISSION_APPROVED', rewardValue: value,
        approvalMode: body.approvalMode, expiryDays: body.expiryDays, expiryAt: body.expiryAt ? new Date(body.expiryAt) : null, monthlyCountCap: body.monthlyCountCap, monthlyAmountCap } });
      await tx.auditLog.create({ data: { clientId, actorId: user.id, action: 'REWARD_RULE_CREATED', entityType: 'RewardRule', entityId: rule.id } });
      return { data: rule };
    });
  }
  @Post('programs/:id/activate') async activate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const clientId = this.client(user);
    return this.prisma.$transaction(async tx => {
      const program = await tx.rewardProgram.findFirst({ where: { id, clientId } });
      if (!program) throw new NotFoundException('REWARD_PROGRAM_NOT_FOUND');
      if (program.status !== 'DRAFT' || !await tx.rewardRule.count({ where: { clientId, programId: id, isActive: true } })) throw new BadRequestException('REWARD_PROGRAM_NOT_READY');
      const updated = await tx.rewardProgram.update({ where: { id }, data: { status: 'ACTIVE' } });
      await tx.auditLog.create({ data: { clientId, actorId: user.id, action: 'REWARD_PROGRAM_ACTIVATED', entityType: 'RewardProgram', entityId: id } });
      return { data: updated };
    });
  }
  @Post('programs/:id/deactivate') async deactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const clientId = this.client(user);
    return this.prisma.$transaction(async tx => {
      const changed = await tx.rewardProgram.updateMany({ where: { id, clientId, status: 'ACTIVE' }, data: { status: 'INACTIVE' } });
      if (!changed.count) throw new NotFoundException('REWARD_PROGRAM_ACTIVE_NOT_FOUND');
      await tx.auditLog.create({ data: { clientId, actorId: user.id, action: 'REWARD_PROGRAM_DEACTIVATED', entityType: 'RewardProgram', entityId: id } });
      return { data: await tx.rewardProgram.findUniqueOrThrow({ where: { id } }) };
    });
  }
  @Get('claims') async claims(@CurrentUser() user: AuthUser) {
    return { data: await this.prisma.rewardClaim.findMany({ where: { clientId: this.client(user) }, orderBy: { createdAt: 'desc' }, take: 100 }) };
  }
  @Post('manual') async manual(@CurrentUser() user: AuthUser, @Headers('idempotency-key') key: string, @Body() body: { riderId: string; amount: string; reason: string }) {
    if (!key || key.length > 120 || !body?.riderId || !body.reason?.trim() || body.reason.length > 500) throw new BadRequestException('MANUAL_REWARD_INVALID');
    const clientId = this.client(user);
    const claim = await this.qualification.qualify(clientId, body.riderId, 'MANUAL', key, user.id, body.amount, body.reason);
    return { data: claim.status === 'APPROVED' ? await this.posting.post(clientId, claim.id, user.id) : claim };
  }
  @Post('self-submissions/:sourceId/approved') async selfSubmission(@CurrentUser() user: AuthUser, @Param('sourceId') sourceId: string, @Body() body: { riderId: string }) {
    if (!body?.riderId) throw new BadRequestException('RIDER_REQUIRED');
    const clientId = this.client(user);
    const claim = await this.qualification.qualify(clientId, body.riderId, 'SELF_SUBMISSION_APPROVED', sourceId, user.id);
    return { data: claim.status === 'APPROVED' ? await this.posting.post(clientId, claim.id, user.id) : claim };
  }
  @Post('claims/:id/approve') async approve(@CurrentUser() user: AuthUser, @Param('id') id: string) { return { data: await this.rewards.approve(this.client(user), id, user.id) }; }
  @Post('claims/:id/reject') async reject(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { reason: string }) { return { data: await this.rewards.reject(this.client(user), id, user.id, body?.reason) }; }
  @Post('claims/:id/cancel') async cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { reason: string }) { return { data: await this.rewards.cancel(this.client(user), id, user.id, body?.reason) }; }
  @Post('claims/:id/reverse') async reverse(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { reason: string }) { return { data: await this.rewards.reverse(this.client(user), id, user.id, body?.reason) }; }
}
