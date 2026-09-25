import { describe, expect, it, vi } from 'vitest';
import { ReferralAccessService } from './referral-access.service.js';

describe('ReferralAccessService', () => {
  it('requires an active package containing REFER_AND_EARN for the authenticated Client', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = new ReferralAccessService({ clientSubscription: { findFirst } } as never);
    await expect(service.requireFeature('client-a')).rejects.toMatchObject({ status: 403 });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      clientId: 'client-a', status: 'ACTIVE', package: { isActive: true, features: { some: { isIncluded: true, feature: { code: 'REFER_AND_EARN', isActive: true } } } },
    }) }));
  });
});
