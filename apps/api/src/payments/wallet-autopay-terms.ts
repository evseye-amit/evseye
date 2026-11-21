import type { Prisma } from '@prisma/client';

export const VARIABLE_POLICY_TERMS = 'wallet-variable-policy-v1';
export const VARIABLE_POLICY_DESCRIPTION = 'AutoPay adds funds to your ledger when its available cash balance falls below the company-configured threshold. The company may change the threshold and recharge amount within your mandate maximum. Each debit requires advance notice and remains subject to cancellation and mandate limits.';
export function variableWalletPolicy(snapshot: Prisma.JsonValue | null | undefined): boolean {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
  return snapshot.scope === 'WALLET_FUNDING' && snapshot.policyTerms === VARIABLE_POLICY_TERMS;
}

/** Public terms only: do not expose rider IDs, setup keys or preference guards. */
export function walletFundingTerms(snapshot: Prisma.JsonValue | null | undefined) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || snapshot.scope !== 'WALLET_FUNDING') return null;
  return {
    policyTerms: typeof snapshot.policyTerms === 'string' ? snapshot.policyTerms : null,
    description: typeof snapshot.termsDescription === 'string' ? snapshot.termsDescription : null,
    threshold: typeof snapshot.threshold === 'string' ? snapshot.threshold : null,
    rechargeAmount: typeof snapshot.rechargeAmount === 'string' ? snapshot.rechargeAmount : null,
    revision: typeof snapshot.consentRevision === 'number' ? snapshot.consentRevision : null,
  };
}
