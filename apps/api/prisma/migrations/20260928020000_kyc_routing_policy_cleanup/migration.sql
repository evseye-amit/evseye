ALTER TABLE "KycIntelligentRoutingPolicy"
  DROP CONSTRAINT "KycIntelligentRoutingPolicy_cost_guardrail_check",
  DROP COLUMN "maxKnownCostPerVerification";
