import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ReferralLinkService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async shareLink(clientId: string, code: string, inviteToken?: string, campaignCode?: string) {
    const domain = await this.prisma.clientDomain.findFirst({
      where: { clientId, isPrimary: true, isVerified: true }, select: { hostname: true },
    });
    if (!domain && this.config.get('NODE_ENV') === 'production') {
      throw new ServiceUnavailableException('A verified primary client domain is required for referral links.');
    }
    const hostname = domain?.hostname ?? 'localhost';
    const local = hostname === 'localhost' || hostname.endsWith('.localhost');
    const url = new URL(`${local ? 'http' : 'https'}://${hostname}${local ? ':3001' : ''}/rider/referral`);
    url.searchParams.set('code', code);
    if (inviteToken) url.searchParams.set('invite', inviteToken);
    if (campaignCode) url.searchParams.set('campaign', campaignCode);
    return url.toString();
  }
}
