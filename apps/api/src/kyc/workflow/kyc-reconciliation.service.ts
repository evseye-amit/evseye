import { Injectable } from '@nestjs/common';

export type MatchClass = 'EXACT' | 'STRONG_MATCH' | 'PARTIAL_MATCH' | 'MISMATCH' | 'UNKNOWN';
export interface MatchThresholds { strong: number; partial: number }
export interface MatchResult { status: MatchClass; score: number | null }

/** Token overlap permits initials, but never silently treats an absent name as a match. */
@Injectable()
export class KycNameMatchService {
  compare(left?: string | null, right?: string | null, thresholds: MatchThresholds = { strong: 80, partial: 50 }): MatchResult {
    if (thresholds.partial < 0 || thresholds.strong > 100 || thresholds.partial > thresholds.strong)
      throw new Error('INVALID_MATCH_THRESHOLDS');
    const normalize = (value?: string | null) => value?.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ') ?? '';
    const a = normalize(left); const b = normalize(right);
    if (!a || !b) return { status: 'UNKNOWN', score: null };
    if (a === b) return { status: 'EXACT', score: 100 };
    const aa = a.split(' '); const bb = b.split(' ');
    const used = new Set<number>();
    const matches = aa.reduce((count, token) => {
      const exact = bb.findIndex((other, index) => !used.has(index) && other === token);
      const initial = exact >= 0 ? -1 : bb.findIndex((other, index) => !used.has(index) &&
        ((token.length === 1 && other.startsWith(token)) || (other.length === 1 && token.startsWith(other))));
      const index = exact >= 0 ? exact : initial;
      if (index < 0) return count;
      used.add(index);
      return count + 1;
    }, 0);
    const score = Math.round(100 * 2 * matches / (aa.length + bb.length));
    return { status: score >= thresholds.strong ? 'STRONG_MATCH' : score >= thresholds.partial ? 'PARTIAL_MATCH' : 'MISMATCH', score };
  }
}

@Injectable()
export class KycReconciliationEngine {
  constructor(private readonly names: KycNameMatchService) {}

  compareDob(left?: string | Date | null, right?: string | Date | null): 'MATCH' | 'MISMATCH' | 'UNKNOWN' {
    if (!left || !right) return 'UNKNOWN';
    const date = (value: string | Date) => value instanceof Date ? value.toISOString().slice(0, 10) : value;
    return date(left) === date(right) ? 'MATCH' : 'MISMATCH';
  }

  reconcile(input: { riderName?: string | null; panName?: string | null; aadhaarName?: string | null;
    bankHolderName?: string | null; riderDob?: string | Date | null; panDob?: string | Date | null;
    thresholds?: MatchThresholds }) {
    const thresholds = input.thresholds ?? { strong: 80, partial: 50 };
    return [
      { type: 'RIDER_NAME_VS_PAN', sourceA: 'RIDER', sourceB: 'PAN', ...this.names.compare(input.riderName, input.panName, thresholds) },
      { type: 'RIDER_NAME_VS_AADHAAR', sourceA: 'RIDER', sourceB: 'AADHAAR', ...this.names.compare(input.riderName, input.aadhaarName, thresholds) },
      { type: 'PAN_NAME_VS_BANK', sourceA: 'PAN', sourceB: 'BANK', ...this.names.compare(input.panName, input.bankHolderName, thresholds) },
      { type: 'RIDER_NAME_VS_BANK', sourceA: 'RIDER', sourceB: 'BANK', ...this.names.compare(input.riderName, input.bankHolderName, thresholds) },
      { type: 'DOB_MATCH', sourceA: 'RIDER', sourceB: 'PAN', status: this.compareDob(input.riderDob, input.panDob), score: null },
    ];
  }
}
