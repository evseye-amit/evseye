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
import {
  OtpPurpose,
  OtpStatus,
  Prisma,
  UserRole,
  type User,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
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
import { OtpSecurity } from './otp-security.js';

interface RefreshPayload extends AuthUser {
  sid: string;
  typ: 'refresh';
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
  ) {
    this.otpSecurity = new OtpSecurity(config);
  }

  private readonly otpSecurity: OtpSecurity;

  private async serializable<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 10000,
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          attempt < 3
        )
          continue;
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
            OR: [{ companyCode }, { slug: companyCode }],
            isActive: true,
            deletedAt: null,
            status: {
              in: ['CREATED', 'PENDING_APPROVAL', 'ACTIVE', 'REJECTED'],
            },
          },
          select: { id: true },
        })
      : null;

    if (
      (companyCode && !client) ||
      (expectedClientId && client?.id !== expectedClientId)
    ) {
      return {
        otpRequestId: randomUUID(),
        expiresAt: this.otpSecurity.expiresAt(),
      };
    }

    const appCode = client ? (requestedAppCode ?? 'CLIENT_PANEL') : undefined;
    if (client && appCode) await this.loginFlow.resolve(companyCode!, appCode);
    const user = await this.prisma.user.findFirst({
      where: client
        ? {
            clientId: client.id,
            mobile: { in: mobileCandidates },
            isActive: true,
            deletedAt: null,
          }
        : {
            clientId: null,
            mobile: { in: mobileCandidates },
            role: UserRole.SUPER_ADMIN,
            isActive: true,
          },
      select: { id: true, mobile: true, role: true },
    });

    if (
      !user ||
      (client &&
        !this.loginFlow.roleAllowed(appCode as LoginAppCode, user.role))
    ) {
      return {
        otpRequestId: randomUUID(),
        expiresAt: this.otpSecurity.expiresAt(),
      };
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
      return {
        otpRequestId: randomUUID(),
        expiresAt: this.otpSecurity.expiresAt(),
      };
    }

    const code = this.otpSecurity.generateCode();
    const expiresAt = this.otpSecurity.expiresAt();
    const otpRequest = await this.prisma.otpRequest.create({
      data: {
        clientId: client?.id,
        purpose: OtpPurpose.LOGIN,
        phone,
        otpHash: this.otpSecurity.hash(code),
        expiresAt,
        maxAttempts: this.config.getOrThrow('OTP_MAX_ATTEMPTS'),
        requestedIp,
        ...(appCode
          ? { context: { loginAppCode: appCode, method: 'SMS_OTP' } }
          : {}),
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
      throw new ServiceUnavailableException(
        'SMS delivery is temporarily unavailable.',
      );
    }

    return { otpRequestId: otpRequest.id, expiresAt: otpRequest.expiresAt };
  }

  async verifyLoginOtp(
    otpRequestId: string,
    code: string,
    expectedClientId?: string,
    requestedAppCode?: string,
  ) {
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

    const boundAppCode =
      otp.context &&
      typeof otp.context === 'object' &&
      !Array.isArray(otp.context)
        ? (otp.context as Record<string, unknown>).loginAppCode
        : undefined;
    if (
      otp.clientId &&
      boundAppCode &&
      (typeof boundAppCode !== 'string' ||
        !this.loginFlow.isAppCode(boundAppCode) ||
        (requestedAppCode && requestedAppCode !== boundAppCode))
    ) {
      throw new UnauthorizedException(
        'Login is unavailable for this application.',
      );
    }

    if (otp.expiresAt <= new Date()) {
      await this.prisma.otpRequest.update({
        where: { id: otp.id },
        data: { status: OtpStatus.EXPIRED },
      });
      throw new UnauthorizedException('OTP has expired.');
    }

    if (!this.otpSecurity.verify(code, otp.otpHash)) {
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
        ? { clientId: otp.clientId, mobile: otp.phone, isActive: true, deletedAt: null }
        : {
            clientId: null,
            mobile: otp.phone,
            role: UserRole.SUPER_ADMIN,
            isActive: true,
            deletedAt: null,
          },
    });
    if (!user) {
      throw new UnauthorizedException('Account is unavailable.');
    }

    if (otp.clientId && boundAppCode) {
      if (
        !this.loginFlow.roleAllowed(boundAppCode as LoginAppCode, user.role)
      ) {
        throw new UnauthorizedException(
          'Login is unavailable for this application.',
        );
      }
    }

    return this.issueTokens(user);
  }

  async requestVehicleSubmissionOtp(
    clientId: string,
    reportId: string,
    digest: string,
    party: 'RIDER' | 'TEAM_LEAD',
    recipientId: string,
    phone: string,
  ) {
    const report = await this.prisma.vehicleSubmissionReport.findFirst({
      where: { id: reportId, clientId, status: 'SUBMITTED', digest },
    });
    if (!report)
      throw new UnauthorizedException(
        'Submission report is no longer current.',
      );
    const purpose =
      party === 'RIDER'
        ? OtpPurpose.HANDOVER_RIDER
        : OtpPurpose.HANDOVER_OPERATOR;
    const recent = await this.prisma.otpRequest.findFirst({
      where: {
        clientId,
        phone,
        purpose,
        status: 'PENDING',
        createdAt: {
          gte: new Date(
            Date.now() -
              this.config.getOrThrow<number>('OTP_RESEND_COOLDOWN_SECONDS') *
                1000,
          ),
        },
      },
    });
    if (recent)
      throw new HttpException(
        'Please wait before requesting another OTP.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    await this.prisma.otpRequest.updateMany({
      where: {
        clientId,
        purpose,
        status: 'PENDING',
        context: { path: ['reportId'], equals: reportId },
      },
      data: { status: 'CANCELLED' },
    });
    const code = this.otpSecurity.generateCode();
    const otp = await this.prisma.otpRequest.create({
      data: {
        clientId,
        purpose,
        phone,
        otpHash: this.otpSecurity.hash(code),
        expiresAt: this.otpSecurity.expiresAt(),
        maxAttempts: this.config.getOrThrow<number>('OTP_MAX_ATTEMPTS'),
        context: { reportId, digest, party, recipientId },
      },
      select: { id: true, expiresAt: true },
    });
    try {
      await this.smsProvider.send({ phone, purpose, code });
    } catch {
      await this.prisma.otpRequest.update({
        where: { id: otp.id },
        data: { status: 'FAILED' },
      });
      throw new ServiceUnavailableException(
        'SMS delivery is temporarily unavailable.',
      );
    }
    return { otpRequestId: otp.id, expiresAt: otp.expiresAt };
  }

  async verifyVehicleSubmissionOtp(
    clientId: string,
    requestId: string,
    code: string,
    expected: {
      reportId: string;
      digest: string;
      party: 'RIDER' | 'TEAM_LEAD';
      recipientId: string;
      phone: string;
    },
    actorId: string,
  ) {
    const outcome = await this.serializable(async (tx) => {
      const purpose =
        expected.party === 'RIDER'
          ? OtpPurpose.HANDOVER_RIDER
          : OtpPurpose.HANDOVER_OPERATOR;
      const otp = await tx.otpRequest.findFirst({
        where: { id: requestId, clientId, purpose, status: 'PENDING' },
      });
      if (!otp) return 'MISSING';
      const context = otp.context as Record<string, unknown> | null;
      if (
        !context ||
        context.reportId !== expected.reportId ||
        context.digest !== expected.digest ||
        context.party !== expected.party ||
        context.recipientId !== expected.recipientId ||
        otp.phone !== expected.phone
      )
        return 'STALE';
      if (otp.expiresAt <= new Date()) {
        await tx.otpRequest.update({
          where: { id: otp.id },
          data: { status: 'EXPIRED' },
        });
        return 'EXPIRED';
      }
      if (!this.otpSecurity.verify(code, otp.otpHash)) {
        const attempts = otp.attempts + 1;
        await tx.otpRequest.update({
          where: { id: otp.id },
          data: {
            attempts,
            status: attempts >= otp.maxAttempts ? 'FAILED' : 'PENDING',
          },
        });
        return 'INVALID';
      }
      const report = await tx.vehicleSubmissionReport.findFirst({
        where: {
          id: expected.reportId,
          clientId,
          status: 'SUBMITTED',
          digest: expected.digest,
        },
      });
      if (!report) return 'STALE';
      const consumed = await tx.otpRequest.updateMany({
        where: { id: otp.id, status: 'PENDING' },
        data: { status: 'VERIFIED', verifiedAt: new Date() },
      });
      if (consumed.count !== 1) return 'USED';
      await tx.vehicleSubmissionReport.update({
        where: { id: report.id },
        data:
          expected.party === 'RIDER'
            ? {
                riderOtpRequestId: otp.id,
                riderVerifiedUserId: expected.recipientId,
              }
            : {
                teamLeadOtpRequestId: otp.id,
                teamLeadVerifiedUserId: expected.recipientId,
              },
      });
      await tx.auditLog.create({
        data: {
          clientId,
          actorId,
          action: 'VEHICLE_SUBMISSION_OTP_VERIFIED',
          entityType: 'VehicleSubmission',
          entityId: report.submissionId,
          newData: {
            reportId: report.id,
            party: expected.party,
            digest: expected.digest,
          },
        },
      });
      return 'VERIFIED';
    });
    if (outcome !== 'VERIFIED')
      throw new UnauthorizedException(
        outcome === 'INVALID'
          ? 'Invalid submission OTP.'
          : outcome === 'EXPIRED'
            ? 'Submission OTP has expired.'
            : 'Submission OTP is unavailable or no longer current.',
      );
    return {
      verified: true,
      reportId: expected.reportId,
      party: expected.party,
    };
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

    if (
      payload.typ !== 'refresh' ||
      !payload.sid ||
      (expectedClientId && payload.clientId !== expectedClientId)
    ) {
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
      !this.otpSecurity.verify(refreshToken, session.refreshTokenHash)
    ) {
      throw new UnauthorizedException('Refresh session is unavailable.');
    }

    const consumed = await this.prisma.session.updateMany({
      where: { id: session.id, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    });
    if (consumed.count !== 1)
      throw new UnauthorizedException('Refresh session has already been used.');
    const user = await this.prisma.user.findFirst({
      where: { id: payload.id, isActive: true, deletedAt: null },
    });
    if (
      !user ||
      user.clientId !== (payload.clientId ?? null) ||
      (expectedClientId && user.clientId !== expectedClientId)
    ) {
      throw new UnauthorizedException('Account is unavailable.');
    }

    return this.issueTokens(user, session.id);
  }

  async revokeSession(
    refreshToken: string,
    expectedClientId?: string,
  ): Promise<void> {
    const payload = await this.jwtService.verifyAsync<RefreshPayload>(
      refreshToken,
      {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
      },
    );
    if (expectedClientId && payload.clientId !== expectedClientId)
      throw new UnauthorizedException('Invalid refresh token.');
    if (payload.typ === 'refresh' && payload.sid && payload.id) {
      await this.prisma.session.updateMany({
        where: { id: payload.sid, userId: payload.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.prisma.pushDevice.updateMany({
        where: { userId: payload.id, sessionId: payload.sid, isActive: true },
        data: { isActive: false, disabledReason: 'LOGGED_OUT' },
      });
    }
  }

  private async issueTokens(user: User, previousSessionId?: string) {
    if (user.deletedAt)
      throw new UnauthorizedException('Account is unavailable.');
    if (
      user.clientId &&
      !(await this.prisma.client.findFirst({
        where: {
          id: user.clientId,
          isActive: true,
          status: { notIn: ['DRAFT', 'SUSPENDED'] },
        },
        select: { id: true },
      }))
    )
      throw new UnauthorizedException('Account is unavailable.');
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
        refreshTokenHash: this.otpSecurity.hash(refreshToken),
        expiresAt: this.futureDate(this.config.getOrThrow('JWT_REFRESH_TTL')),
      },
    });

    if (previousSessionId)
      await this.prisma.pushDevice.updateMany({
        where: {
          userId: user.id,
          sessionId: previousSessionId,
          isActive: true,
        },
        data: { sessionId },
      });

    return { accessToken, refreshToken, tokenType: 'Bearer' as const };
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
