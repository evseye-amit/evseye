import { describe, expect, it, vi } from 'vitest';
import { ReferralLinkService } from './referral-link.service.js';

describe('ReferralLinkService', () => {
  it('uses the local web port for development referral links', async () => {
    const prisma = { clientDomain: { findFirst: vi.fn().mockResolvedValue({ hostname: 'yogmaya.localhost' }) } };
    const service = new ReferralLinkService(prisma as never);
    await expect(service.shareLink('client-1', 'EVS-ABCD2345')).resolves.toBe(
      'http://yogmaya.localhost:3001/rider/referral?code=EVS-ABCD2345',
    );
  });

  it('keeps the production domain on HTTPS', async () => {
    const prisma = { clientDomain: { findFirst: vi.fn().mockResolvedValue({ hostname: 'riders.example.com' }) } };
    const service = new ReferralLinkService(prisma as never);
    await expect(service.shareLink('client-1', 'EVS-ABCD2345')).resolves.toBe(
      'https://riders.example.com/rider/referral?code=EVS-ABCD2345',
    );
  });
});
