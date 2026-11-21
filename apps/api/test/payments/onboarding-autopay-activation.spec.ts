import { describe, expect, it, vi } from 'vitest';
import { UnifiedAutoPayService } from '../../src/payments/unified-autopay.service.js';
function fixture() {
  const attempt = { id: 'attempt', clientId: 'client', autoPayMandateId: 'mandate',
    autoPayConsent: { scope: 'WALLET_FUNDING', authorizationSource: 'PROVIDER_CHECKOUT', actorId: 'user', riderId: 'rider', consentRevision: 3, termsCreatedAt: '2026-11-21T10:00:00Z' },
    autoPayMandate: { riderId: 'rider', authorizedAt: new Date(), providerAuthorizationPaymentId: 'pay_auth', providerTokenId: 'token_auth' } };
  const db = { paymentMandate: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) }, deploymentPaymentAttempt: { findFirst: vi.fn().mockResolvedValue(attempt), findMany: vi.fn().mockResolvedValue([attempt]), update: vi.fn() } };
  const funding = { setEnabled: vi.fn().mockResolvedValue({ enabled: true }) };
  const config = { get: (key: string) => key === 'UNIFIED_AUTOPAY_CLIENT_IDS' ? 'client' : 'true' };
  const service = new UnifiedAutoPayService(db as never, funding as never, config as never);
  return { attempt, db, funding, service };
}
describe('provider-authorized onboarding wallet activation', () => {
  it('enables saved terms without PUT or an accepted flag', async () => {
    const f = fixture(); await f.service.activateOnboarding('mandate');
    expect(f.db.deploymentPaymentAttempt.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'PAID', autoPayRequested: true, autoPayMandate: { status: 'ACTIVE', providerCancelRequestedAt: null, walletAutoRechargePreferences: { none: {} } } }) }));
    expect(f.funding.setEnabled).toHaveBeenCalledWith('client', 'user', { enabled: true, unified: true, mandateId: 'mandate', consentRevision: 3, expectedRevision: 0, recoveryConsentAt: new Date('2026-11-21T10:00:00Z') });
  });
  it.each(['authorizedAt', 'providerAuthorizationPaymentId', 'providerTokenId'])('requires provider evidence: %s', async (field) => {
    const f = fixture(); (f.attempt.autoPayMandate as Record<string, unknown>)[field] = null;
    await f.service.activateOnboarding('mandate'); expect(f.funding.setEnabled).not.toHaveBeenCalled();
  });
  it('rejects a different rider', async () => {
    const f = fixture(); f.attempt.autoPayMandate.riderId = 'another';
    await f.service.activateOnboarding('mandate'); expect(f.funding.setEnabled).not.toHaveBeenCalled();
  });
  it('skips attempts excluded by the paid/active/no-existing-preference query', async () => {
    const f = fixture(); f.db.deploymentPaymentAttempt.findFirst.mockResolvedValue(null);
    await f.service.activateOnboarding('mandate'); expect(f.funding.setEnabled).not.toHaveBeenCalled();
  });
  it('never retries using weaker guards after a disable conflict', async () => {
    const f = fixture(); f.funding.setEnabled.mockRejectedValue(new Error('AUTOPAY_DISABLED_AFTER_CONSENT'));
    await expect(f.service.activateOnboarding('mandate')).resolves.toBeUndefined(); expect(f.funding.setEnabled).toHaveBeenCalledTimes(1);
  });
  it('recovers missed activation with the same guards', async () => {
    const f = fixture(); await f.service.recoverOnboarding(); expect(f.funding.setEnabled).toHaveBeenCalledTimes(1);
  });
});
