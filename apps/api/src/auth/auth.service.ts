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
import { OtpPurpose, OtpStatus, UserRole, type User } from '@prisma/client';
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
import {
  SMS_PROVIDER,
  type SmsProvider,
} from './sms/sms-provider.interface.js';

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
  ) {}

  async requestLoginOtp(
    phone: string,
    companyCode?: string,
    requestedIp?: string,
    expectedClientId?: string,
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

    const user = await this.prisma.user.findFirst({
      where: client
        ? { clientId: client.id, mobile: { in: mobileCandidates }, isActive: true }
        : {
            clientId: null,
            mobile: { in: mobileCandidates },
            role: UserRole.SUPER_ADMIN,
            isActive: true,
          },
      select: { id: true, mobile: true },
    });

    if (!user) {
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
      },
      select: { id: true, expiresAt: true },
    });

    try {
      await this.smsProvider.send({
        phone,
        purpose: OtpPurpose.LOGIN,
        code,
      });
    } catch {
      await this.prisma.otpRequest.update({
        where: { id: otpRequest.id },
        data: { status: OtpStatus.FAILED },
      });
      throw new ServiceUnavailableException('SMS delivery is temporarily unavailable.');
    }

    return { otpRequestId: otpRequest.id, expiresAt: otpRequest.expiresAt };
  }

  async verifyLoginOtp(otpRequestId: string, code: string, expectedClientId?: string) {
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
