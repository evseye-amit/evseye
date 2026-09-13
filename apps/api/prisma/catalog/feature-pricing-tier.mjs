import { readFile } from 'node:fs/promises';

const PRICING_HEADERS = [
  'featureId', 'Feature Name', 'pricingModel', 'billingUnit', 'currency',
  'basePrice', 'unitPrice', 'costPrice', 'minimumCharge', 'maximumCharge',
  'setupFee', 'billingCycle', 'taxInclusive', 'effectiveFrom', 'effectiveTo',
  'isActive', 'metadata',
];
const TIER_HEADERS = [
  'featurePricingId', 'tierOrder', 'tierName', 'fromQuantity', 'toQuantity',
  'unitPrice', 'costPrice',
];
const PRICING_MODELS = new Set([
  'FREE', 'INCLUDED', 'FLAT_FEE', 'PER_UNIT', 'TIERED', 'VOLUME', 'PER_USER',
  'PER_RIDER', 'PER_VEHICLE', 'PER_FLEET', 'USAGE_BASED', 'PER_DEVICE',
  'ONE_TIME', 'CUSTOM',
]);
const BILLING_CYCLES = new Set(['ONCE', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY']);
const BILLING_UNITS = new Set([
  'VERIFICATION', 'RIDER', 'VEHICLE', 'FLEET', 'USER', 'API_CALL', 'FACE_SCAN',
  'TRAINING', 'DEVICE', 'MONTH', 'LIFE_TIME',
]);

function parseCsv(contents, label) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index];
    if (quoted) {
      if (character === '"' && contents[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(value);
      value = '';
    } else if (character === '\n') {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      value = '';
    } else value += character;
  }
  if (value || row.length) rows.push([...row, value.replace(/\r$/, '')]);
  if (quoted) throw new Error(`${label} has an unterminated quoted value.`);
  return rows;
}

function assertHeaders(headers, expected, label) {
  if (headers.length !== expected.length || headers.some((header, index) => header !== expected[index])) {
    throw new Error(`${label} headers must be exactly: ${expected.join(', ')}`);
  }
}

function numberOrNull(value, rowNumber, fieldName) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Feature pricing seed row ${rowNumber} has an invalid ${fieldName}.`);
  return Math.round((parsed + Number.EPSILON) * 1000) / 1000;
}

function requiredInteger(value, rowNumber, fieldName) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Feature pricing tier row ${rowNumber} has an invalid ${fieldName}.`);
  }
  return parsed;
}

const [pricingContents, tierContents] = await Promise.all([
  readFile(new URL('./feature-pricing.csv', import.meta.url), 'utf8'),
  readFile(new URL('./feature-pricing-tiers.csv', import.meta.url), 'utf8'),
]);
const [pricingHeaders, ...pricingRows] = parseCsv(pricingContents, 'Feature pricing seed');
const [tierHeaders, ...tierRows] = parseCsv(tierContents, 'Feature pricing tiers seed');
assertHeaders(pricingHeaders, PRICING_HEADERS, 'Feature pricing seed');
assertHeaders(tierHeaders, TIER_HEADERS, 'Feature pricing tiers seed');

const sourcePricing = pricingRows
  .filter((row) => row.some((value) => value.trim()))
  .map((row, index) => {
    const rowNumber = index + 2;
    if (row.length !== PRICING_HEADERS.length) throw new Error(`Feature pricing seed row ${rowNumber} has an invalid column count.`);
    const [sourceFeatureId, featureName, pricingModel, billingUnit, currency, basePrice, unitPrice, costPrice, minimumCharge, maximumCharge, setupFee, billingCycle, taxInclusive, effectiveFrom, effectiveTo, isActive, metadataText] = row;
    if (!PRICING_MODELS.has(pricingModel)) throw new Error(`Feature pricing seed row ${rowNumber} has unsupported pricing model: ${pricingModel}`);
    if (!BILLING_UNITS.has(billingUnit)) throw new Error(`Feature pricing seed row ${rowNumber} has unsupported billing unit: ${billingUnit}`);
    if (!BILLING_CYCLES.has(billingCycle)) throw new Error(`Feature pricing seed row ${rowNumber} has unsupported billing cycle: ${billingCycle}`);
    const metadata = JSON.parse(metadataText);
    if (!metadata.featureCode || !featureName.trim()) throw new Error(`Feature pricing seed row ${rowNumber} requires Feature Name and metadata.featureCode.`);
    return {
      sourceFeatureId: sourceFeatureId.trim(),
      featureCode: metadata.featureCode,
      pricingModel,
      billingUnit,
      currency: currency.trim(),
      basePrice: numberOrNull(basePrice, rowNumber, 'basePrice') ?? 0,
      unitPrice: numberOrNull(unitPrice, rowNumber, 'unitPrice') ?? 0,
      costPrice: numberOrNull(costPrice, rowNumber, 'costPrice') ?? 0,
      minimumCharge: numberOrNull(minimumCharge, rowNumber, 'minimumCharge'),
      maximumCharge: numberOrNull(maximumCharge, rowNumber, 'maximumCharge'),
      setupFee: numberOrNull(setupFee, rowNumber, 'setupFee') ?? 0,
      billingCycle,
      taxInclusive: taxInclusive.trim().toLowerCase() === 'true',
      effectiveFrom: new Date(effectiveFrom),
      effectiveTo: effectiveTo.trim() ? new Date(effectiveTo) : null,
      isActive: isActive.trim().toLowerCase() === 'true',
      metadata,
    };
  });

export const featurePricingTierCatalog = tierRows
  .filter((row) => row.some((value) => value.trim()))
  .map((row, index) => {
    const rowNumber = index + 2;
    if (row.length !== TIER_HEADERS.length) throw new Error(`Feature pricing tier row ${rowNumber} has an invalid column count.`);
    const [featurePricingId, tierOrder, tierName, fromQuantity, toQuantity, unitPrice, costPrice] = row;
    const normalizedName = tierName.trim();
    if (!featurePricingId.trim() || !normalizedName) throw new Error(`Feature pricing tier row ${rowNumber} requires featurePricingId and tierName.`);
    return {
      featurePricingId: featurePricingId.trim(),
      tierOrder: requiredInteger(tierOrder, rowNumber, 'tierOrder'),
      tierName: normalizedName,
      fromQuantity: BigInt(requiredInteger(fromQuantity, rowNumber, 'fromQuantity')),
      toQuantity: toQuantity.trim() ? BigInt(requiredInteger(toQuantity, rowNumber, 'toQuantity')) : null,
      unitPrice: numberOrNull(unitPrice, rowNumber, 'unitPrice'),
      costPrice: numberOrNull(costPrice, rowNumber, 'costPrice'),
    };
  });

const tierPricingIds = [...new Set(featurePricingTierCatalog.map((tier) => tier.featurePricingId))];
const tieredPricing = sourcePricing.filter((pricing) => pricing.pricingModel === 'TIERED');
if (tierPricingIds.length !== tieredPricing.length) {
  throw new Error(`Feature pricing seed has ${tieredPricing.length} tiered prices but the tier seed has ${tierPricingIds.length} price groups.`);
}
if (featurePricingTierCatalog.length !== tierPricingIds.length * 4) {
  throw new Error('Feature pricing tier seed must provide exactly four tiers for every tiered price.');
}

const pricingIdBySourceFeatureId = new Map(
  tieredPricing.map((pricing, index) => [pricing.sourceFeatureId, tierPricingIds[index]]),
);

export const featurePricingCatalog = sourcePricing.map((pricing) => ({
  ...pricing,
  id: pricingIdBySourceFeatureId.get(pricing.sourceFeatureId),
}));
