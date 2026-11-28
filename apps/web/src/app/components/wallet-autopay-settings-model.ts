export type AutoPayPolicy = {
  unifiedRollout?: boolean;
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
