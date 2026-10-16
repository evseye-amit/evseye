import { describe, expect, it, vi } from 'vitest';
import { RiderDocumentReviewService } from './rider-document-review.service.js';

function setup(nameFieldCode = 'FULL_NAME') {
  const document = {
    id: 'doc-1', rider: null, photo: { objectKey: 'documents/proof.png' },
    user: { name: 'Pending Rider', mobile: '+919000000000', riderOnboardingProgress: { values: { FULL_NAME: 'Aman Singh' } } },
  };
  const prisma = { riderOnboardingDocument: {
    findMany: vi.fn().mockResolvedValue([document]), findFirst: vi.fn().mockResolvedValue(document),
  } };
  const configuration = { getEffectiveConfiguration: vi.fn().mockResolvedValue({ onboarding: { steps: [
    { fields: nameFieldCode ? [{ storageKey: 'name', fieldCode: nameFieldCode }] : [] },
  ] } }) };
  return { document, service: new RiderDocumentReviewService(prisma as never, configuration as never) };
}

describe('RiderDocumentReviewService rider names', () => {
  it.each(['FULL_NAME', 'RENAMED_NAME', ''])('uses saved onboarding names before a Rider exists (%s)', async (code) => {
    const { service } = setup(code);
    expect((await service.list('client-1', {}))[0]).toMatchObject({ riderName: 'Aman Singh', photo: { fileName: 'proof.png' } });
    expect(await service.get('client-1', 'doc-1')).toMatchObject({ riderName: 'Aman Singh' });
  });

  it('does not expose onboarding values and prefers a completed Rider name', async () => {
    const { document, service } = setup();
    Object.assign(document, { rider: { name: 'Updated Rider' } });
    const result = await service.get('client-1', 'doc-1');
    expect(result.riderName).toBe('Updated Rider');
    expect(result.user).not.toHaveProperty('riderOnboardingProgress');
  });
});
