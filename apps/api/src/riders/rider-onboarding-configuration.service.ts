import { BadRequestException, Injectable } from '@nestjs/common';
import { FeatureCategory, Prisma } from '@prisma/client';
import { normalizeIndianMobile } from '../common/phone.js';
import { PrismaService } from '../prisma/prisma.service.js';

type JsonRecord = Record<string, unknown>;
type RiderField = {
  fieldId: string;
  featureId: string;
  featureCode: string;
  fieldCode: string;
  storageKey: string;
  fieldName: string;
  label: string;
  description?: string;
  placeholder?: string;
  fieldType: string;
  dataType?: string;
  required: boolean;
  readOnly: boolean;
  disabled: boolean;
  editable: boolean;
  importable: boolean;
  billingUnit: string;
  isUpload: boolean;
  sequence: number;
  validation: JsonRecord;
  configuration: JsonRecord;
};

type RiderOnboardingConfiguration = {
  package: { id: string; code: string; name: string };
  onboarding: {
    category: FeatureCategory;
    steps: Array<{
      stepId: string;
      stepCode: string;
      stepName: string;
      description: string | null;
      parentId: string | null;
      sequence: number;
      active: boolean;
      enabled: boolean;
      fields: RiderField[];
    }>;
  };
};

const asRecord = (value: unknown): JsonRecord =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

@Injectable()
export class RiderOnboardingConfigurationService {
  constructor(private readonly prisma: PrismaService) {}

  async getEffectiveConfiguration(clientId: string): Promise<RiderOnboardingConfiguration> {
    const now = new Date();
    const subscription = await this.prisma.clientSubscription.findFirst({
      where: {
        clientId,
        status: 'ACTIVE',
        startDate: { lte: now },
        OR: [{ endDate: null }, { endDate: { gte: now } }],
        package: { isActive: true },
      },
      orderBy: { startDate: 'desc' },
      include: {
        package: {
          include: {
            features: {
              where: {
                isIncluded: true,
                feature: {
                  isActive: true,
                  category: FeatureCategory.RIDER_ONBOARDING,
                  featureStep: { isActive: true },
                },
              },
              include: { feature: { include: { featureStep: true } } },
            },
          },
        },
      },
    });
    if (!subscription) {
      throw new BadRequestException(
        'No active package is available for Rider Onboarding.',
      );
    }

    const grouped = new Map<
      string,
      RiderOnboardingConfiguration['onboarding']['steps'][number]
    >();
    for (const packageFeature of subscription.package.features) {
      const feature = packageFeature.feature;
      const step = feature.featureStep;
      if (!step) continue;
      const featureConfiguration = asRecord(feature.configuration);
      const packageConfiguration = asRecord(packageFeature.configuration);
      const configuration: JsonRecord = {
        ...featureConfiguration,
        ...packageConfiguration,
        validation: {
          ...asRecord(featureConfiguration.validation),
          ...asRecord(packageConfiguration.validation),
        },
      };
      const fieldCode = String(configuration.fieldCode ?? '').trim();
      const storageKey = String(configuration.storageKey ?? '').trim();
      if (configuration.enabled === false) continue;

      const field: RiderField = {
        fieldId: feature.id,
        featureId: feature.id,
        featureCode: feature.code,
        fieldCode,
        storageKey,
        fieldName: feature.name,
        label: String(configuration.label ?? feature.name),
        description: feature.description ?? undefined,
        placeholder:
          typeof configuration.placeholder === 'string'
            ? configuration.placeholder
            : undefined,
        fieldType: String(configuration.fieldType ?? 'TEXT'),
        dataType:
          typeof configuration.dataType === 'string'
            ? configuration.dataType
            : undefined,
        required: configuration.required === true,
        readOnly: configuration.readOnly === true,
        disabled: configuration.disabled === true,
        editable: configuration.editable !== false,
        importable: configuration.importable === true,
        billingUnit: feature.billingUnit,
        isUpload: feature.billingUnit === 'UPLOAD',
        sequence:
          packageFeature.displayOrder > 0
            ? packageFeature.displayOrder
            : feature.displayOrder,
        validation: asRecord(configuration.validation),
        configuration,
      };
      const current = grouped.get(step.id) ?? {
        stepId: step.id,
        stepCode: step.code,
        stepName: step.displayName,
        description: step.description,
        parentId: step.parentId,
        sequence: step.displayOrder,
        active: step.isActive,
        enabled: true,
        fields: [],
      };
      current.fields.push(field);
      grouped.set(step.id, current);
    }

    const steps = [...grouped.values()]
      .map((step) => ({
        ...step,
        fields: step.fields.sort((left, right) => left.sequence - right.sequence),
      }))
      .sort((left, right) => left.sequence - right.sequence);
    return {
      package: {
        id: subscription.package.id,
        code: subscription.package.code,
        name: subscription.package.name,
      },
      onboarding: { category: FeatureCategory.RIDER_ONBOARDING, steps },
    };
  }

  async validateAndMapValues(
    clientId: string,
    values: Record<string, unknown>,
    mode: 'CREATE' | 'EDIT' | 'IMPORT',
    existingMetadata: unknown = {},
    options: { requireAll?: boolean } = {},
  ) {
    const configuration = await this.getEffectiveConfiguration(clientId);
    const fields = configuration.onboarding.steps.flatMap((step) => step.fields);
    const inputFields = fields.filter((field): field is RiderField & { fieldCode: string; storageKey: string } => Boolean(field.fieldCode && field.storageKey));
    const allowed = new Map(inputFields.map((field) => [field.fieldCode, field]));
    for (const code of Object.keys(values)) {
      if (!allowed.has(code)) {
        throw new BadRequestException(`${code} is not available in the client's active package.`);
      }
    }
    const mapped: Record<string, unknown> = {};
    const metadata = { ...asRecord(existingMetadata) };
    for (const field of inputFields) {
      if (mode === 'EDIT' && (!field.editable || field.readOnly || field.disabled)) continue;
      const supplied = values[field.fieldCode];
      const value = supplied === undefined || supplied === null ? '' : String(supplied).trim();
      if (options.requireAll !== false && field.required && !value) {
        throw new BadRequestException(`${field.fieldCode} is required.`);
      }
      if (!value) continue;
      this.validateValue(field, value);
      const normalized = field.fieldType === 'MOBILE' ? normalizeIndianMobile(value) : value;
      if (field.storageKey.startsWith('metadata.')) {
        metadata[field.storageKey.slice('metadata.'.length)] = normalized;
      } else {
        mapped[field.storageKey] =
          field.dataType === 'DATE' ? this.parseDate(field, normalized) : normalized;
      }
    }
    if (Object.keys(metadata).length) mapped.metadata = metadata;
    return { configuration, data: mapped };
  }

  private validateValue(field: RiderField, value: string) {
    const validation = field.validation;
    const minLength = Number(validation.minLength ?? 0);
    const maxLength = Number(validation.maxLength ?? 0);
    if (minLength && value.length < minLength) {
      throw new BadRequestException(`${field.fieldCode} must contain at least ${minLength} characters.`);
    }
    if (maxLength && value.length > maxLength) {
      throw new BadRequestException(`${field.fieldCode} must contain at most ${maxLength} characters.`);
    }
    if (typeof validation.pattern === 'string' && !new RegExp(validation.pattern).test(value)) {
      throw new BadRequestException(`${field.fieldCode} is invalid.`);
    }
    const options = Array.isArray(validation.allowedValues)
      ? validation.allowedValues
      : Array.isArray(field.configuration.options)
        ? field.configuration.options
        : [];
    if (options.length && !options.map(String).includes(value)) {
      throw new BadRequestException(`${field.fieldCode} value is not allowed.`);
    }
  }

  private parseDate(field: RiderField, value: string): Date {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    const display = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
    const year = Number(iso?.[1] ?? display?.[3]);
    const month = Number(iso?.[2] ?? display?.[2]);
    const day = Number(iso?.[3] ?? display?.[1]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if ((!iso && !display) || date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
      throw new BadRequestException(`${field.fieldCode} is invalid.`);
    }
    return date;
  }
}
