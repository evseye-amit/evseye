import { describe, expect, it, vi } from 'vitest';
import { RiderRateCardsController } from '../../src/rider-rate-cards/rider-rate-cards.controller.js';

describe('RiderRateCardsController preview rules', () => {
  it('passes the authenticated client context to the preview service', async () => {
    const previewRules = vi.fn().mockResolvedValue({
      versionId: 'version-1',
      fees: [],
      deposits: [],
    });
    const requireClientId = vi.fn().mockReturnValue('client-a');
    const body = {
      versionId: 'version-1',
      city: 'Hyderabad',
      hubId: 'hub-a',
      oemId: 'oem-a',
      workPartnerId: 'partner-a',
      ageMonths: 18,
    };
    const controller = new RiderRateCardsController(
      { previewRules } as never,
      { requireClientId } as never,
      {} as never,
    );

    const result = await controller.previewRules(
      { id: 'user-a', clientId: 'client-a', roles: [] } as never,
      body,
    );

    expect(requireClientId).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-a' }));
    expect(previewRules).toHaveBeenCalledWith('client-a', body);
    expect(result).toEqual({ versionId: 'version-1', fees: [], deposits: [] });
  });
});
