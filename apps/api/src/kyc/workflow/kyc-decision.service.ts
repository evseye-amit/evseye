import { Injectable } from '@nestjs/common';
import type { KycDecisionOutcome, KycStepStatus, Prisma } from '@prisma/client';

export type DecisionCondition =
  | { kind: 'REQUIRED_STEP_FAILED' }
  | { kind: 'REQUIRED_STEPS_VERIFIED' }
  | { kind: 'RECONCILIATION_STATUS'; statuses: string[] }
  | { kind: 'ALWAYS' };

export interface DecisionInput {
  steps: { required: boolean; status: KycStepStatus }[];
  reconciliations: { status: string }[];
}

@Injectable()
export class KycDecisionEngine {
  explain(reasonCode: string): string {
    const explanations: Record<string, string> = {
      ALL_REQUIRED_CHECKS_PASSED: 'All required verification checks passed.',
      REQUIRED_CHECK_FAILED: 'A required verification check failed and needs review.',
      NAME_OR_DOB_MISMATCH: 'The rider identity differs from the submitted verification identity.',
      INSUFFICIENT_DATA: 'Available verification evidence is insufficient for an automatic decision.',
      MANUAL_REVIEW_APPROVED: 'An authorized reviewer approved this KYC journey.',
      MANUAL_REVIEW_REJECTED: 'An authorized reviewer rejected this KYC journey.',
    };
    return explanations[reasonCode] ?? reasonCode.replaceAll('_', ' ').toLowerCase();
  }

  decide(input: DecisionInput, rules: { id: string; priority: number; code: string; condition: Prisma.JsonValue;
    action: KycDecisionOutcome; reasonCode: string }[]) {
    const ordered = [...rules].sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code));
    for (const rule of ordered) {
      const condition = this.parse(rule.condition);
      if (this.matches(condition, input)) return { decision: rule.action, reasonCode: rule.reasonCode, ruleId: rule.id };
    }
    return { decision: 'MANUAL_REVIEW' as const, reasonCode: 'INSUFFICIENT_DATA', ruleId: null };
  }

  private parse(value: Prisma.JsonValue): DecisionCondition {
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.kind !== 'string')
      throw new Error('INVALID_KYC_DECISION_RULE');
    switch (value.kind) {
      case 'REQUIRED_STEP_FAILED': case 'REQUIRED_STEPS_VERIFIED': case 'ALWAYS': return { kind: value.kind };
      case 'RECONCILIATION_STATUS':
        if (!Array.isArray(value.statuses) || !value.statuses.every((status) => typeof status === 'string'))
          throw new Error('INVALID_KYC_DECISION_RULE');
        return { kind: 'RECONCILIATION_STATUS', statuses: value.statuses as string[] };
      default: throw new Error('INVALID_KYC_DECISION_RULE');
    }
  }

  private matches(condition: DecisionCondition, input: DecisionInput) {
    switch (condition.kind) {
      case 'REQUIRED_STEP_FAILED': return input.steps.some((step) => step.required && ['FAILED', 'EXPIRED'].includes(step.status));
      case 'REQUIRED_STEPS_VERIFIED': return input.steps.filter((step) => step.required).length > 0 &&
        input.steps.filter((step) => step.required).every((step) => step.status === 'VERIFIED') &&
        input.reconciliations.every((result) => !['MISMATCH', 'PARTIAL_MATCH'].includes(result.status));
      case 'RECONCILIATION_STATUS': return input.reconciliations.some((result) => condition.statuses.includes(result.status));
      case 'ALWAYS': return true;
    }
  }
}
