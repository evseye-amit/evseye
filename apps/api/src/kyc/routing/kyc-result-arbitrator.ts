import { Injectable } from '@nestjs/common';
import type { KycArbitrationMode } from '@prisma/client';
import type { ProviderResult } from '../verification/kyc-types.js';

export interface RoutedOutcome {
  attemptId: string;
  providerId: string;
  result: ProviderResult;
  completedAt: number;
}

@Injectable()
export class KycResultArbitrator {
  arbitrate(outcomes: RoutedOutcome[], mode: KycArbitrationMode = 'MANUAL_REVIEW_ON_CONFLICT') {
    if (!outcomes.length) throw new Error('KYC_NO_ROUTING_OUTCOMES');
    const ordered = [...outcomes].sort((a, b) => a.completedAt - b.completedAt || a.attemptId.localeCompare(b.attemptId));
    const terminal = ordered.filter((item) => item.result.failureType !== 'TECHNICAL_FAILURE');
    const verified = terminal.filter((item) => item.result.status === 'VERIFIED');
    const businessFailures = terminal.filter((item) => ['FAILED', 'REJECTED'].includes(item.result.status));
    const conflict = verified.length > 0 && businessFailures.length > 0;
    const manual = (): RoutedOutcome => ({ attemptId: ordered[0].attemptId, providerId: ordered[0].providerId,
      completedAt: ordered[0].completedAt,
      result: { status: 'MANUAL_REVIEW', data: {}, failureCode: 'PROVIDER_CONFLICT', failureType: 'BUSINESS_FAILURE', failureCategory: 'PROVIDER_CONFLICT' } });
    let winner: RoutedOutcome;
    if (conflict) return { winner: manual(), conflict, conflicting: terminal };
    switch (mode) {
      case 'FIRST_VERIFIED': winner = verified[0] ?? terminal[0] ?? ordered[0]; break;
      case 'FIRST_TERMINAL': winner = terminal[0] ?? ordered[0]; break;
      case 'MAJORITY': {
        const counts = new Map<string, number>();
        for (const item of terminal) counts.set(item.result.status, (counts.get(item.result.status) ?? 0) + 1);
        const majority = [...counts].find(([, count]) => count > outcomes.length / 2)?.[0];
        winner = majority ? terminal.find((item) => item.result.status === majority)! : manual();
        break;
      }
      case 'ALL_MUST_AGREE': winner = terminal.length === outcomes.length && terminal.every((item) => item.result.status === terminal[0].result.status)
        ? terminal[0] : manual(); break;
      case 'MANUAL_REVIEW_ON_CONFLICT': winner = conflict ? manual() : verified[0] ?? terminal[0] ?? ordered[0]; break;
    }
    return { winner, conflict, conflicting: conflict ? ordered.filter((item) => item.result.failureType !== 'TECHNICAL_FAILURE') : [] };
  }
}
