import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OtpPurpose, OtpStatus, Prisma, UserRole, type User } from '@prisma/client';
import {
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type { Environment } from '../config/environment.js';
import { indianMobileVariants } from '../common/phone.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from './interfaces/auth-user.interface.js';
import { SmsQuotaService } from './sms-quota.service.js';
import { LoginFlowService, type LoginAppCode } from './login-flow.service.js';
import {
  SMS_PROVIDER,
  type SmsProvider,
} from './sms/sms-provider.interface.js';

interface RefreshPayload extends AuthUser {
  sid: string;
  typ: 'refresh';
}

interface ReturnPenaltyOtpContext {
  caseId: string;
  riderId: string;
  revision: number;
  digest: string;
  totalAmount: string;
  currency: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService<Environment, true>,
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
    private readonly smsQuota: SmsQuotaService,
    private readonly loginFlow: LoginFlowService,
  ) {}

  private async serializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 10000,
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 3) continue;
        throw error;
      }
    }
  }

  async requestLoginOtp(
    phone: string,
    companyCode?: string,
    requestedIp?: string,
    expectedClientId?: string,
    requestedAppCode?: string,
  ) {
    const mobileCandidates = indianMobileVariants(phone);
    const client = companyCode
      ? await this.prisma.client.findFirst({
          where: {
            companyCode,
            isActive: true,
            status: {
              in: [
                'CREATED',
                'PENDING_APPROVAL',
                'ACTIVE',
                'REJECTED',
              ],
            },
          },
          select: { id: true },
        })
      : null;

    if ((companyCode && !client) || (expectedClientId && client?.id !== expectedClientId)) {
      return { otpRequestId: randomUUID(), expiresAt: new Date(Date.now() + this.config.getOrThrow('OTP_TTL_SECONDS') * 1000) };
    }

    const appCode = client ? requestedAppCode ?? 'CLIENT_PANEL' : undefined;
    if (client && appCode) await this.loginFlow.resolve(companyCode!, appCode);
    const user = await this.prisma.user.findFirst({
      where: client
        ? { clientId: client.id, mobile: { in: mobileCandidates }, isActive: true }
        : {
            clientId: null,
            mobile: { in: mobileCandidates },
            role: UserRole.SUPER_ADMIN,
            isActive: true,
          },
      select: { id: true, mobile: true, role: true },
    });

    if (!user || (client && !this.loginFlow.roleAllowed(appCode as LoginAppCode, user.role))) {
      return { otpRequestId: randomUUID(), expiresAt: new Date(Date.now() + this.config.getOrThrow('OTP_TTL_SECONDS') * 1000) };
    }
    // Use the stored representation for OTP audit and dispatch. This supports
    // existing records saved as +91XXXXXXXXXX, 0XXXXXXXXXX, or XXXXXXXXXX.
    phone = user.mobile;

    const cooldownAt = new Date(
      Date.now() - this.config.getOrThrow('OTP_RESEND_COOLDOWN_SECONDS') * 1000,
    );
    const recent = await this.prisma.otpRequest.findFirst({
      where: {
        clientId: client?.id,
        phone,
        purpose: OtpPurpose.LOGIN,
        status: OtpStatus.PENDING,
        createdAt: { gte: cooldownAt },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    if (recent) {
      // Use the same accepted shape for unknown accounts and cooldown requests.
      return { otpRequestId: randomUUID(), expiresAt: new Date(Date.now() + this.config.getOrThrow('OTP_TTL_SECONDS') * 1000) };
    }

    const code = this.generateOtpCode();
    const expiresAt = new Date(
      Date.now() + this.config.getOrThrow('OTP_TTL_SECONDS') * 1000,
    );
    const otpRequest = await this.prisma.otpRequest.create({
      data: {
        clientId: client?.id,
        purpose: OtpPurpose.LOGIN,
        phone,
        otpHash: this.hashSecret(code),
        expiresAt,
        maxAttempts: this.config.getOrThrow('OTP_MAX_ATTEMPTS'),
        requestedIp,
        ...(appCode ? { context: { loginAppCode: appCode, method: 'SMS_OTP' } } : {}),
      },
      select: { id: true, expiresAt: true },
    });

    try {
      if (client) await this.smsQuota.reserve(client.id, otpRequest.id);
      await this.smsProvider.send({
        phone,
        purpose: OtpPurpose.LOGIN,
        code,
      });
    } catch (error) {
      if (client) await this.smsQuota.refund(client.id, otpRequest.id);
      await this.prisma.otpRequest.update({
        where: { id: otpRequest.id },
        data: { status: OtpStatus.FAILED },
      });
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('SMS delivery is temporarily unavailable.');
    }

    return { otpRequestId: otpRequest.id, expiresAt: otpRequest.expiresAt };
  }

  async verifyLoginOtp(otpRequestId: string, code: string, expectedClientId?: string, requestedAppCode?: string) {
    const otp = await this.prisma.otpRequest.findUnique({
      where: { id: otpRequestId },
    });
    if (
      !otp ||
      (expectedClientId && otp.clientId !== expectedClientId) ||
      otp.purpose !== OtpPurpose.LOGIN ||
      otp.status !== OtpStatus.PENDING
    ) {
      throw new UnauthorizedException('Invalid OTP request.');
    }

    const boundAppCode = otp.context && typeof otp.context === 'object' && !Array.isArray(otp.context)
      ? (otp.context as Record<string, unknown>).loginAppCode : undefined;
    if (otp.clientId && boundAppCode &&
      (typeof boundAppCode !== 'string' || !this.loginFlow.isAppCode(boundAppCode) ||
        (requestedAppCode && requestedAppCode !== boundAppCode))) {
      throw new UnauthorizedException('Login is unavailable for this application.');
    }

    if (otp.expiresAt <= new Date()) {
      await this.prisma.otpRequest.update({
        where: { id: otp.id },
        data: { status: OtpStatus.EXPIRED },
      });
      throw new UnauthorizedException('OTP has expired.');
    }

    if (!this.verifySecret(code, otp.otpHash)) {
      const attempts = otp.attempts + 1;
      await this.prisma.otpRequest.update({
        where: { id: otp.id },
        data: {
          attempts,
          status:
            attempts >= otp.maxAttempts ? OtpStatus.FAILED : OtpStatus.PENDING,
        },
      });
      throw new UnauthorizedException('Invalid OTP.');
    }

    const markedVerified = await this.prisma.otpRequest.updateMany({
      where: { id: otp.id, status: OtpStatus.PENDING },
      data: { status: OtpStatus.VERIFIED, verifiedAt: new Date() },
    });
    if (markedVerified.count !== 1) {
      throw new UnauthorizedException('OTP has already been used.');
    }

    const user = await this.prisma.user.findFirst({
      where: otp.clientId
        ? { clientId: otp.clientId, mobile: otp.phone, isActive: true }
        : {
            clientId: null,
            mobile: otp.phone,
            role: UserRole.SUPER_ADMIN,
            isActive: true,
          },
    });
    if (!user) {
      throw new UnauthorizedException('Account is unavailable.');
    }

    if (otp.clientId && boundAppCode) {
      if (!this.loginFlow.roleAllowed(boundAppCode as LoginAppCode, user.role)) {
        throw new UnauthorizedException('Login is unavailable for this application.');
      }
    }

    return this.issueTokens(user);
  }

  async requestDeallocationOtp(
    clientId: string,
    phone: string,
    allocationId: string,
    purpose: OtpPurpose,
  ) {
    const allocation = await this.prisma.allocation.findFirst({
      where: { id: allocationId, clientId, status: 'DEALLOCATION_INITIATED' },
      select: { id: true },
    });
    if (!allocation)
      throw new UnauthorizedException('Deallocation is not active.');

    const cooldownAt = new Date(
      Date.now() - this.config.getOrThrow('OTP_RESEND_COOLDOWN_SECONDS') * 1000,
    );
    const recent = await this.prisma.otpRequest.findFirst({
      where: {
        clientId,
        phone,
        purpose,
        status: OtpStatus.PENDING,
        createdAt: { gte: cooldownAt },
        context: { path: ['allocationId'], equals: allocationId },
      },
      select: { id: true },
    });
    if (recent) {
      throw new HttpException('Please wait before requesting another OTP.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const code = this.generateOtpCode();
    const expiresAt = new Date(
      Date.now() + this.config.getOrThrow('OTP_TTL_SECONDS') * 1000,
    );
    const otp = await this.prisma.otpRequest.create({
      data: {
        clientId,
        purpose,
        phone,
        otpHash: this.hashSecret(code),
        expiresAt,
        maxAttempts: this.config.getOrThrow('OTP_MAX_ATTEMPTS'),
        context: { allocationId },
      },
      select: { id: true, expiresAt: true },
    });
    try {
      await this.smsProvider.send({
        phone,
        purpose,
        code,
      });
    } catch {
      await this.prisma.otpRequest.update({
        where: { id: otp.id },
        data: { status: OtpStatus.FAILED },
      });
      throw new ServiceUnavailableException('SMS delivery is temporarily unavailable.');
    }
    return { otpRequestId: otp.id, expiresAt: otp.expiresAt };
  }

  async verifyDeallocationOtp(
    clientId: string,
    otpRequestId: string,
    code: string,
  ) {
    const otp = await this.prisma.otpRequest.findFirst({
      where: {
        id: otpRequestId,
        clientId,
        status: OtpStatus.PENDING,
        purpose: {
          in: [OtpPurpose.DEALLOCATION_RIDER, OtpPurpose.DEALLOCATION_OPERATOR],
        },
      },
    });
    if (!otp) {
      throw new UnauthorizedException('Invalid deallocation OTP request.');
    }

    if (otp.expiresAt <= new Date()) {
      await this.prisma.otpRequest.update({
        where: { id: otp.id },
        data: { status: OtpStatus.EXPIRED },
      });
      throw new UnauthorizedException('Deallocation OTP has expired.');
    }

    if (!this.verifySecret(code, otp.otpHash)) {
      const attempts = otp.attempts + 1;
      await this.prisma.otpRequest.update({
        where: { id: otp.id },
        data: {
          attempts,
          status:
            attempts >= otp.maxAttempts ? OtpStatus.FAILED : OtpStatus.PENDING,
        },
      });
      throw new UnauthorizedException('Invalid deallocation OTP.');
    }

    const updated = await this.prisma.otpRequest.updateMany({
      where: { id: otp.id, status: OtpStatus.PENDING },
      data: { status: OtpStatus.VERIFIED, verifiedAt: new Date() },
    });
    if (updated.count !== 1) {
      throw new UnauthorizedException('OTP has already been used.');
    }
    return { verified: true };
  }

  async requestReturnPenaltyOtp(
    clientId: string,
    caseId: string,
    riderId: string,
    expected: Omit<ReturnPenaltyOtpContext, 'caseId' | 'riderId'>,
  ) {
    const rider = await this.prisma.rider.findFirst({
      where: { id: riderId, clientId, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, mobile: true },
    });
    if (!rider) throw new UnauthorizedException('Rider account is unavailable.');
    const penaltyCase = await this.prisma.returnPenaltyCase.findFirst({
      where: {
        id: caseId,
        clientId,
        riderId,
        status: 'RIDER_APPROVAL_PENDING',
        currentRevision: expected.revision,
        digest: expected.digest,
      },
      select: { id: true, totalAmount: true, currency: true },
    });
    if (!penaltyCase || !penaltyCase.totalAmount.eq(new Prisma.Decimal(expected.totalAmount)) || penaltyCase.currency !== expected.currency)
      throw new UnauthorizedException('Penalty approval is no longer current.');
    const cooldownAt = new Date(Date.now() - this.config.getOrThrow<number>('OTP_RESEND_COOLDOWN_SECONDS') * 1000);
    const recent = await this.prisma.otpRequest.findFirst({
      where: {
        clientId,
        purpose: OtpPurpose.RETURN_PENALTY_APPROVAL,
        status: OtpStatus.PENDING,
        phone: rider.mobile,
        createdAt: { gte: cooldownAt },
        context: { path: ['caseId'], equals: caseId },
      },
      select: { id: true },
    });
    if (recent) throw new HttpException('Please wait before requesting another OTP.', HttpStatus.TOO_MANY_REQUESTS);
    await this.prisma.otpRequest.updateMany({
      where: { clientId, purpose: OtpPurpose.RETURN_PENALTY_APPROVAL, status: OtpStatus.PENDING, context: { path: ['caseId'], equals: caseId } },
      data: { status: OtpStatus.CANCELLED },
    });
    const code = this.generateOtpCode();
    const otp = await this.prisma.otpRequest.create({
      data: {
        clientId,
        purpose: OtpPurpose.RETURN_PENALTY_APPROVAL,
        phone: rider.mobile,
        otpHash: this.hashSecret(code),
        expiresAt: new Date(Date.now() + this.config.getOrThrow<number>('OTP_TTL_SECONDS') * 1000),
        maxAttempts: this.config.getOrThrow<number>('OTP_MAX_ATTEMPTS'),
        context: { caseId, riderId, ...expected },
      },
      select: { id: true, expiresAt: true },
    });
    try {
      await this.smsProvider.send({ phone: rider.mobile, purpose: OtpPurpose.RETURN_PENALTY_APPROVAL, code });
    } catch {
      await this.prisma.otpRequest.update({ where: { id: otp.id }, data: { status: OtpStatus.FAILED } });
      throw new ServiceUnavailableException('SMS delivery is temporarily unavailable.');
    }
    return { otpRequestId: otp.id, expiresAt: otp.expiresAt };
  }

  async verifyReturnPenaltyOtp(
    clientId: string,
    otpRequestId: string,
    code: string,
    expected: ReturnPenaltyOtpContext,
    onApproved?: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    const outcome = await this.serializable(async (tx) => {
      const otp = await tx.otpRequest.findFirst({
        where: { id: otpRequestId, clientId, purpose: OtpPurpose.RETURN_PENALTY_APPROVAL, status: OtpStatus.PENDING },
      });
      if (!otp) return { kind: 'MISSING' as const };
      if (otp.expiresAt <= new Date()) {
        await tx.otpRequest.update({ where: { id: otp.id }, data: { status: OtpStatus.EXPIRED } });
        return { kind: 'EXPIRED' as const };
      }
      const context = otp.context;
      const current = context && typeof context === 'object' && !Array.isArray(context)
        ? context as Partial<ReturnPenaltyOtpContext>
        : {};
      const contextMatches = current.caseId === expected.caseId && current.riderId === expected.riderId && current.revision === expected.revision && current.digest === expected.digest && current.totalAmount === expected.totalAmount && current.currency === expected.currency;
      if (!contextMatches) return { kind: 'STALE' as const };
      if (!this.verifySecret(code, otp.otpHash)) {
        const attempts = otp.attempts + 1;
        await tx.otpRequest.update({ where: { id: otp.id }, data: { attempts, status: attempts >= otp.maxAttempts ? OtpStatus.FAILED : OtpStatus.PENDING } });
        return { kind: 'INVALID_CODE' as const };
      }
      const penaltyCase = await tx.returnPenaltyCase.findFirst({ where: { id: expected.caseId, clientId, riderId: expected.riderId, status: 'RIDER_APPROVAL_PENDING', currentRevision: expected.revision, digest: expected.digest } });
      if (!penaltyCase || !penaltyCase.totalAmount.eq(new Prisma.Decimal(expected.totalAmount)) || penaltyCase.currency !== expected.currency)
        return { kind: 'STALE' as const };
      const consumed = await tx.otpRequest.updateMany({ where: { id: otp.id, status: OtpStatus.PENDING }, data: { status: OtpStatus.VERIFIED, verifiedAt: new Date() } });
      if (consumed.count !== 1) return { kind: 'USED' as const };
      const updated = await tx.returnPenaltyCase.updateMany({ where: { id: penaltyCase.id, status: 'RIDER_APPROVAL_PENDING', currentRevision: expected.revision, digest: expected.digest }, data: { status: 'MANAGER_APPROVAL_PENDING', riderApprovedRevision: expected.revision, riderApprovedAt: new Date(), riderApprovalOtpRequestId: otp.id } });
      if (updated.count !== 1) return { kind: 'STALE' as const };
      await tx.auditLog.create({ data: { clientId, actorId: null, action: 'RETURN_PENALTIES_RIDER_APPROVED', entityType: 'ReturnPenaltyCase', entityId: penaltyCase.id, newData: { revision: expected.revision, digest: expected.digest, totalAmount: expected.totalAmount } } });
      if (onApproved) await onApproved(tx);
      return { kind: 'VERIFIED' as const, caseId: penaltyCase.id, revision: expected.revision };
    });
    if (outcome.kind === 'MISSING') throw new UnauthorizedException('Invalid return penalty OTP request.');
    if (outcome.kind === 'EXPIRED') throw new UnauthorizedException('Return penalty OTP has expired.');
    if (outcome.kind === 'STALE') throw new UnauthorizedException('Return penalty approval is no longer current.');
    if (outcome.kind === 'INVALID_CODE') throw new UnauthorizedException('Invalid return penalty OTP.');
    if (outcome.kind === 'USED') throw new UnauthorizedException('OTP has already been used.');
    return { verified: true, caseId: outcome.caseId, revision: outcome.revision };
  }

  async refresh(refreshToken: string, expectedClientId?: string) {
    let payload: RefreshPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshPayload>(
        refreshToken,
        {
          secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
        },
      );
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    if (payload.typ !== 'refresh' || !payload.sid || (expectedClientId && payload.clientId !== expectedClientId)) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    const session = await this.prisma.session.findFirst({
      where: {
        id: payload.sid,
        userId: payload.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (
      !session ||
      !this.verifySecret(refreshToken, session.refreshTokenHash)
    ) {
      throw new UnauthorizedException('Refresh session is unavailable.');
    }

    const consumed = await this.prisma.session.updateMany({
      where: { id: session.id, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    });
    if (consumed.count !== 1) throw new UnauthorizedException('Refresh session has already been used.');
    const user = await this.prisma.user.findFirst({
      where: { id: payload.id, isActive: true },
    });
    if (!user || user.clientId !== (payload.clientId ?? null) || (expectedClientId && user.clientId !== expectedClientId)) {
      throw new UnauthorizedException('Account is unavailable.');
    }

    return this.issueTokens(user);
  }

  private generateOtpCode(): string {
    return this.config.getOrThrow('NODE_ENV') === 'development' && this.config.getOrThrow('SMS_PROVIDER') === 'console'
      ? '123456'
      : randomInt(100_000, 1_000_000).toString();
  }

  async revokeSession(refreshToken: string, expectedClientId?: string): Promise<void> {
    const payload = await this.jwtService.verifyAsync<RefreshPayload>(
      refreshToken,
      {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
      },
    );
    if (expectedClientId && payload.clientId !== expectedClientId) throw new UnauthorizedException('Invalid refresh token.');
    if (payload.typ === 'refresh' && payload.sid && payload.id) {
      await this.prisma.session.updateMany({
        where: { id: payload.sid, userId: payload.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }

  private async issueTokens(user: User) {
    if (user.deletedAt) throw new UnauthorizedException('Account is unavailable.');
    if (user.clientId && !await this.prisma.client.findFirst({ where: { id: user.clientId, isActive: true, status: { notIn: ['DRAFT', 'SUSPENDED'] } }, select: { id: true } })) throw new UnauthorizedException('Account is unavailable.');
    const authUser: AuthUser = {
      id: user.id,
      clientId: user.clientId,
      roles: [user.role],
    };
    const sessionId = randomUUID();
    const accessToken = await this.jwtService.signAsync(
      { ...authUser, sid: sessionId, typ: 'access' },
      {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
        expiresIn: this.config.getOrThrow('JWT_ACCESS_TTL'),
      },
    );
    const refreshToken = await this.jwtService.signAsync(
      { ...authUser, sid: sessionId, typ: 'refresh' },
      {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
        expiresIn: this.config.getOrThrow('JWT_REFRESH_TTL'),
      },
    );
    await this.prisma.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        refreshTokenHash: this.hashSecret(refreshToken),
        expiresAt: this.futureDate(this.config.getOrThrow('JWT_REFRESH_TTL')),
      },
    });

    return { accessToken, refreshToken, tokenType: 'Bearer' as const };
  }

  private hashSecret(value: string): string {
    return createHmac('sha256', this.config.getOrThrow('OTP_HASH_SECRET'))
      .update(value)
      .digest('hex');
  }

  private verifySecret(value: string, hash: string): boolean {
    const expected = Buffer.from(hash, 'hex');
    const actual = Buffer.from(this.hashSecret(value), 'hex');
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }

  private futureDate(ttl: string): Date {
    const match = /^(\d+)([dhm])$/.exec(ttl);
    if (!match) {
      throw new Error(`Unsupported duration format: ${ttl}`);
    }
    const multiplier = { d: 86_400_000, h: 3_600_000, m: 60_000 }[
      match[2] as 'd' | 'h' | 'm'
    ];
    return new Date(Date.now() + Number(match[1]) * multiplier);
  }
}
