export type AutoPayPolicy = {
  unifiedRollout?: boolean;
  effectiveEnabled?: boolean;
  canEnable?: boolean;
  reasonCode?: string | null;
  reasonMessage?: string | null;
  provider?: string | null;
  environment?: string;
  setupTerms?: { maxAmount: string; validityDays: number } | null;
  enabled: boolean;
  threshold: string;
  rechargeAmount: string;
  revision: number;
};

export function autoPayPolicySaveBody(policy: AutoPayPolicy) {
  return {
    enabled: policy.enabled,
    threshold: Number(policy.threshold).toFixed(2),
    rechargeAmount: Number(policy.rechargeAmount).toFixed(2),
    revision: policy.revision,
  };
}
