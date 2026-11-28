import test from "node:test";
import assert from "node:assert/strict";
import { autoPayPolicySaveBody } from "../../../src/app/components/wallet-autopay-settings-model.ts";

test("AutoPay policy updates only send fields accepted by the API", () => {
  const body = autoPayPolicySaveBody({
    unifiedRollout: true,
    effectiveEnabled: false,
    canEnable: false,
    reasonCode: "PACKAGE_TERMS_INVALID",
    setupTerms: { maxAmount: "750.00", validityDays: 365 },
    enabled: true,
    threshold: "550",
    rechargeAmount: "1750",
    revision: 3,
  });

  assert.deepEqual(body, {
    enabled: true,
    threshold: "550.00",
    rechargeAmount: "1750.00",
    revision: 3,
  });
  assert.equal(Object.hasOwn(body, "unifiedRollout"), false);
});
