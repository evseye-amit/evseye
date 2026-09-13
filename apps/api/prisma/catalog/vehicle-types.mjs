import { readFile } from 'node:fs/promises';

const REQUIRED_HEADERS = [
  'id',
  'categoryId',
  'code',
  'name',
  'subCategory',
  'description',
  'energyType',
  'usageType',
  'status',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
];

const CATEGORY_CODE_BY_SOURCE_ID = new Map([
  ['073bd28f-6cda-4839-9a21-8218de3498d9', '2W'],
  ['c00dd8b6-102b-487a-a15c-af4f9d1293a2', '3W'],
  ['6d24cb87-fd6f-45c4-9623-fd339a4464ae', '4W'],
  ['e07edd38-d2ca-47fa-b23b-70d494c23ce2', 'BUS'],
  ['671e41db-5eb7-4560-b56c-18217ac3e86d', 'TRUCK'],
  ['021a63c3-1018-432b-b3cb-874cbc14f8f3', 'TRACTOR'],
  ['87d0a822-4636-44d2-97bd-189dac0e1380', 'TRAILER'],
  ['637328de-5a18-4b9c-b360-608389c5b9c4', 'CEV'],
  ['b1e6114e-87e3-4f3c-b4d6-3792fe465466', 'SPV'],
]);

const ENERGY_TYPES = new Set([
  'ELECTRIC',
  'HYBRID',
  'PETROL',
  'DIESEL',
  'CNG',
  'HYDROGEN',
  'OTHER',
  'LPG',
]);

const USAGE_TYPES = new Set([
  'PRIVATE',
  'PASSENGER',
  'GOODS',
  'DELIVERY',
  'SHARED_MOBILITY',
  'PUBLIC_TRANSPORT',
  'STAFF_TRANSPORT',
  'SCHOOL_TRANSPORT',
  'EMERGENCY',
  'AGRICULTURAL',
  'CONSTRUCTION',
  'INDUSTRIAL',
  'RENTAL',
  'GOVERNMENT',
  'SPECIAL_PURPOSE',
]);

const STATUSES = new Set(['ACTIVE', 'INACTIVE', 'SUSPENDED']);

function parseCsv(contents) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotedValue = false;

  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index];

    if (inQuotedValue) {
      if (character === '"') {
        if (contents[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          inQuotedValue = false;
        }
      } else {
        value += character;
      }
      continue;
    }

    if (character === '"') {
      inQuotedValue = true;
    } else if (character === ',') {
      row.push(value);
      value = '';
    } else if (character === '\n') {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += character;
    }
  }

  if (value || row.length > 0) {
    row.push(value.replace(/\r$/, ''));
    rows.push(row);
  }

  if (inQuotedValue) {
    throw new Error('Vehicle type seed CSV contains an unterminated quoted value.');
  }

  return rows;
}

const csvContents = await readFile(
  new URL('./vehicle-types.csv', import.meta.url),
  'utf8',
);
const [headers, ...dataRows] = parseCsv(csvContents);

if (
  headers.length !== REQUIRED_HEADERS.length ||
  headers.some((header, index) => header !== REQUIRED_HEADERS[index])
) {
  throw new Error(
    `Vehicle type seed CSV headers must be exactly: ${REQUIRED_HEADERS.join(', ')}`,
  );
}

const seededCodes = new Set();

export const vehicleTypeCatalog = dataRows
  .filter((row) => row.some((value) => value.trim()))
  .map((row, index) => {
    const rowNumber = index + 2;
    if (row.length !== REQUIRED_HEADERS.length) {
      throw new Error(
        `Vehicle type seed row ${rowNumber} must contain ${REQUIRED_HEADERS.length} columns.`,
      );
    }

    const [
      ,
      sourceCategoryId,
      rawCode,
      rawName,
      rawSubCategory,
      rawDescription,
      rawEnergyType,
      rawUsageType,
      rawStatus,
    ] = row;
    const categoryCode = CATEGORY_CODE_BY_SOURCE_ID.get(sourceCategoryId.trim());
    const code = rawCode.trim().toUpperCase();
    const name = rawName.trim();
    const energyType = rawEnergyType.trim();
    const usageType = rawUsageType.trim();
    const status = rawStatus.trim();

    if (!categoryCode || !code || !name || !energyType || !status) {
      throw new Error(
        `Vehicle type seed row ${rowNumber} requires a known category, code, name, energy type, and status.`,
      );
    }
    if (seededCodes.has(code)) {
      throw new Error(`Vehicle type seed has a duplicate code: ${code}`);
    }
    if (!ENERGY_TYPES.has(energyType)) {
      throw new Error(
        `Vehicle type seed row ${rowNumber} has an unsupported energy type: ${energyType}`,
      );
    }
    if (usageType && !USAGE_TYPES.has(usageType)) {
      throw new Error(
        `Vehicle type seed row ${rowNumber} has an unsupported usage type: ${usageType}`,
      );
    }
    if (!STATUSES.has(status)) {
      throw new Error(
        `Vehicle type seed row ${rowNumber} has an unsupported status: ${status}`,
      );
    }

    seededCodes.add(code);

    return {
      categoryCode,
      code,
      name,
      subCategory: rawSubCategory.trim() || null,
      description: rawDescription.trim() || null,
      energyType,
      usageType: usageType || null,
      status,
    };
  });
