import { BadRequestException } from '@nestjs/common';
import type { ResolvedComponent } from '../workflow/workflow-resolver.service.js';

export const riderBankFields = [
  {
    fieldCode: 'IFSC_CODE',
    label: 'IFSC Code',
    storageKey: 'metadata.ifscCode',
    required: true,
    validation: { pattern: '^[A-Z]{4}0[A-Z0-9]{6}$', maxLength: 11 },
  },
  {
    fieldCode: 'BANK_NAME',
    label: 'Bank Name',
    storageKey: 'metadata.bankName',
    required: false,
    validation: { maxLength: 150 },
  },
  {
    fieldCode: 'BANK_BRANCH',
    label: 'Branch',
    storageKey: 'metadata.bankBranch',
    required: false,
    validation: { maxLength: 200 },
  },
  {
    fieldCode: 'BANK_CITY',
    label: 'City',
    storageKey: 'metadata.bankCity',
    required: false,
    validation: { maxLength: 100 },
  },
  {
    fieldCode: 'BANK_STATE',
    label: 'State',
    storageKey: 'metadata.bankState',
    required: false,
    validation: { maxLength: 100 },
  },
  {
    fieldCode: 'BANK_ACCOUNT_NUMBER',
    label: 'Account Number',
    storageKey: 'metadata.bankAccountNumber',
    required: true,
    validation: { pattern: '^[0-9]{6,40}$', maxLength: 40 },
  },
] as const;

// One package feature controls all six inputs. Old published bank components had
// no field definitions; defaults make those components usable without rewriting revisions.
export function expandRiderBankComponent(
  component: ResolvedComponent,
): ResolvedComponent[] {
  if (component.featureCode !== 'CAPTURE_BANK_ACCOUNT') return [component];
  if (component.configuration.enabled === false) return [];
  const {
    fields,
    translations: _groupTranslations,
    ...group
  } = component.configuration;
  const overrides = Array.isArray(fields) ? fields : [];
  return riderBankFields.map((field, index) => {
    const custom = overrides.find(
      (value) =>
        value &&
        typeof value === 'object' &&
        (value as Record<string, unknown>).fieldCode === field.fieldCode,
    ) as Record<string, unknown> | undefined;
    return {
      ...component,
      featureName: field.label,
      description: null,
      componentType: 'FIELD',
      order: component.order + index / 100,
      configuration: {
        ...group,
        componentType: 'FIELD',
        fieldType: 'TEXT',
        dataType: 'STRING',
        editable: true,
        importable: true,
        ...field,
        ...custom,
        fieldCode: field.fieldCode,
        storageKey: field.storageKey,
        validation: {
          ...field.validation,
          ...(custom?.validation as Record<string, unknown> | undefined),
        },
      },
    };
  });
}

export function normalizeRiderBankValues(
  values: Record<string, unknown>,
  allowedCodes: ReadonlySet<string>,
) {
  const normalized = { ...values };
  for (const field of riderBankFields) {
    if (
      !allowedCodes.has(field.fieldCode) ||
      values[field.fieldCode] === undefined ||
      values[field.fieldCode] === null
    )
      continue;
    const raw = values[field.fieldCode];
    if (typeof raw !== 'string')
      throw new BadRequestException(`${field.fieldCode} must be a string.`);
    const value =
      field.fieldCode === 'IFSC_CODE' ? raw.trim().toUpperCase() : raw.trim();
    if (
      value &&
      (value.length > field.validation.maxLength ||
        ('pattern' in field.validation &&
          !new RegExp(field.validation.pattern).test(value)))
    )
      throw new BadRequestException(`${field.fieldCode} is invalid.`);
    normalized[field.fieldCode] = value;
  }
  return normalized;
}
