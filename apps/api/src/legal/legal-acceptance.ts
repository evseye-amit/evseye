import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';

export type LegalAcceptanceCopy = {
  declarationTitle: string;
  declaration: string;
  checkboxLabel: string;
  continueLabel: string;
};

export const defaultConsentAcceptance: LegalAcceptanceCopy = {
  declarationTitle: 'Declaration',
  declaration: 'I declare that I have understood the points of this consent form and agree in my capacity as the data principal.',
  checkboxLabel: 'I have read and understood this consent form and give my consent.',
  continueLabel: 'Continue',
};

export function consentAcceptance(
  kind: string,
  locale: string,
  value: unknown,
  publishing = false,
): LegalAcceptanceCopy | undefined {
  if (kind !== 'PRIVACY_CONSENT') return undefined;
  const source = value ?? (locale === 'en' ? defaultConsentAcceptance : undefined);
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    if (publishing) throw new BadRequestException('Provide the declaration and acceptance checkbox wording in the document language.');
    return undefined;
  }
  const result = {} as LegalAcceptanceCopy;
  for (const key of Object.keys(defaultConsentAcceptance) as Array<keyof LegalAcceptanceCopy>) {
    const text = (source as Record<string, unknown>)[key];
    if (typeof text !== 'string' || text.length > 2000 || (publishing && !text.trim()))
      throw new BadRequestException(`Invalid consent acceptance field: ${key}.`);
    result[key] = text.trim();
  }
  return result;
}

export const legalHash = (content: string, acceptance?: unknown) => createHash('sha256')
  .update(acceptance
    ? JSON.stringify({
      content,
      acceptance: Object.fromEntries(
        Object.entries(acceptance as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
      ),
    })
    : content, 'utf8')
  .digest('hex');
