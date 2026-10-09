import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ReferralLinkService {
  constructor(private readonly prisma: PrismaService) {}

  async shareLink(clientId: string, code: string, inviteToken?: string) {
    const domain = await this.prisma.clientDomain.findFirst({
      where: { clientId, isPrimary: true, isVerified: true }, select: { hostname: true },
    });
    if (!domain) throw new ServiceUnavailableException('A verified primary client domain is required for referral links.');
    const local = domain.hostname.endsWith('.localhost');
    const url = new URL(`${local ? 'http' : 'https'}://${domain.hostname}${local ? ':3001' : ''}/rider/referral`);
    url.searchParams.set('code', code);
    if (inviteToken) url.searchParams.set('invite', inviteToken);
    return url.toString();
  }
}
