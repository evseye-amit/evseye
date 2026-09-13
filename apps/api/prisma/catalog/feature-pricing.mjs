import { readFile } from 'node:fs/promises';

const REQUIRED_HEADERS = [
  'featureId',
  'pricingModel',
  'billingUnit',
  'currency',
  'basePrice',
  'unitPrice',
  'costPrice',
  'minimumCharge',
  'maximumCharge',
  'setupFee',
  'billingCycle',
  'taxInclusive',
  'effectiveFrom',
  'effectiveTo',
  'isActive',
  'metadata',
];

const PRICING_MODEL_MAP = new Map([['FLAT_RATE', 'FLAT_FEE']]);
const BILLING_UNIT_MAP = new Map([
  ['OTP', 'API_CALL'],
  ['MANDATE', 'USER'],
  ['SIGNATURE', 'USER'],
  ['TENANT_MONTH', 'MONTH'],
]);
const PRICING_MODELS = new Set([
  'FREE', 'INCLUDED', 'FLAT_FEE', 'PER_UNIT', 'TIERED', 'VOLUME',
  'PER_USER', 'PER_RIDER', 'PER_VEHICLE', 'PER_FLEET', 'USAGE_BASED',
  'PER_DEVICE', 'ONE_TIME', 'CUSTOM',
]);
const BILLING_CYCLES = new Set(['ONCE', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY']);
const BILLING_UNITS = new Set([
  'VERIFICATION', 'RIDER', 'VEHICLE', 'FLEET', 'USER', 'API_CALL',
  'FACE_SCAN', 'TRAINING', 'DEVICE', 'MONTH', 'LIFE_TIME',
]);

function parseCsv(contents) {
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
    else if (character === ',') { row.push(value); value = ''; }
    else if (character === '\n') { row.push(value.replace(/\r$/, '')); rows.push(row); row = []; value = ''; }
    else value += character;
  }
  if (value || row.length) rows.push([...row, value.replace(/\r$/, '')]);
  if (quoted) throw new Error('Feature pricing catalog has an unterminated quoted value.');
  return rows;
}

function numberOrNull(value, rowNumber, fieldName) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Feature pricing row ${rowNumber} has an invalid ${fieldName}.`);
  return parsed;
}

const contents = await readFile(new URL('./feature-pricing.csv', import.meta.url), 'utf8');
const [headers, ...rows] = parseCsv(contents);
if (headers.length !== REQUIRED_HEADERS.length || headers.some((header, index) => header !== REQUIRED_HEADERS[index])) {
  throw new Error(`Feature pricing catalog headers must be exactly: ${REQUIRED_HEADERS.join(', ')}`);
}

export const featurePricingCatalog = rows
  .filter((row) => row.some((value) => value.trim()))
  .map((row, index) => {
    const rowNumber = index + 2;
    if (row.length !== REQUIRED_HEADERS.length) throw new Error(`Feature pricing row ${rowNumber} has an invalid column count.`);
    const [sourceFeatureId, rawModel, billingUnit, currency, basePrice, unitPrice, costPrice, minimumCharge, maximumCharge, setupFee, billingCycle, taxInclusive, effectiveFrom, effectiveTo, isActive, metadataText] = row;
    const pricingModel = PRICING_MODEL_MAP.get(rawModel) ?? rawModel;
    if (!PRICING_MODELS.has(pricingModel)) throw new Error(`Feature pricing row ${rowNumber} has unsupported pricing model: ${rawModel}`);
    if (!BILLING_CYCLES.has(billingCycle)) throw new Error(`Feature pricing row ${rowNumber} has unsupported billing cycle: ${billingCycle}`);
    const normalizedBillingUnit = BILLING_UNIT_MAP.get(billingUnit.trim()) ?? billingUnit.trim();
    if (!BILLING_UNITS.has(normalizedBillingUnit)) throw new Error(`Feature pricing row ${rowNumber} has unsupported billing unit: ${billingUnit}`);
    const metadata = JSON.parse(metadataText);
    if (!metadata.featureCode) throw new Error(`Feature pricing row ${rowNumber} metadata requires featureCode.`);
    return {
      sourceFeatureId: sourceFeatureId.trim(),
      featureCode: metadata.featureCode,
      pricingModel,
      billingUnit: normalizedBillingUnit,
      currency: currency.trim(),
      basePrice: numberOrNull(basePrice, rowNumber, 'basePrice') ?? 0,
      unitPrice: numberOrNull(unitPrice, rowNumber, 'unitPrice') ?? 0,
      costPrice: numberOrNull(costPrice, rowNumber, 'costPrice') ?? 0,
      minimumCharge: numberOrNull(minimumCharge, rowNumber, 'minimumCharge'),
      maximumCharge: numberOrNull(maximumCharge, rowNumber, 'maximumCharge'),
      setupFee: numberOrNull(setupFee, rowNumber, 'setupFee') ?? 0,
      billingCycle,
      taxInclusive: taxInclusive.trim() === 'true',
      effectiveFrom: new Date(effectiveFrom),
      effectiveTo: effectiveTo.trim() ? new Date(effectiveTo) : null,
      isActive: isActive.trim() === 'true',
      metadata,
    };
  });
