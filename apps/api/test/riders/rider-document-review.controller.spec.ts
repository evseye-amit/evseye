import { UserRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { RiderDocumentReviewController } from '../../src/riders/rider-document-review.controller.js';

describe('RiderDocumentReviewController fleet-manager scope', () => {
  const user = {
    id: 'manager-1',
    clientId: 'client-a',
    roles: [UserRole.FLEET_MANAGER],
  };

  it('forwards the authenticated actor to every document scope operation', async () => {
    const document = { id: 'doc-1', fieldCode: 'AADHAAR', rejectionReason: null };
    const documents = {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(document),
      approve: vi.fn().mockResolvedValue(document),
      reject: vi.fn().mockResolvedValue(document),
    };
    const controller = new RiderDocumentReviewController(
      documents as never,
      { requireClientId: vi.fn().mockReturnValue('client-a') } as never,
      { record: vi.fn().mockResolvedValue(undefined) } as never,
    );

    await controller.list(user, {});
    await controller.get(user, 'doc-1');
    await controller.approve(user, 'doc-1');
    await controller.reject(user, 'doc-1', { rejectionReason: 'Bad document' });

    expect(documents.list).toHaveBeenCalledWith('client-a', {}, user);
    expect(documents.get).toHaveBeenCalledWith('client-a', 'doc-1', user);
    expect(documents.approve).toHaveBeenCalledWith('client-a', user.id, 'doc-1', user);
    expect(documents.reject).toHaveBeenCalledWith('client-a', user.id, 'doc-1', 'Bad document', user);
  });
});
