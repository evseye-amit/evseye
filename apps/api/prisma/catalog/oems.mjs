import { readFile } from 'node:fs/promises';

const REQUIRED_HEADERS = [
  'OEM ID',
  'OEM Code',
  'OEM Name',
  'Display Name',
  'OEM Type',
  'Status',
  'Logo',
  'Website',
  'Description',
];

const STATUS_MAP = new Map([
  ['Active', 'ACTIVE'],
  ['Inactive', 'INACTIVE'],
  ['Suspended', 'SUSPENDED'],
]);

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
    throw new Error('OEM seed CSV contains an unterminated quoted value.');
  }

  return rows;
}

function optionalUrl(value, rowNumber, fieldName) {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  try {
    const parsed = new URL(trimmedValue);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('unsupported protocol');
    }
  } catch {
    throw new Error(
      `OEM seed row ${rowNumber} has an invalid ${fieldName} URL: ${trimmedValue}`,
    );
  }

  return trimmedValue;
}

const csvContents = await readFile(new URL('./oems.csv', import.meta.url), 'utf8');
const [headers, ...dataRows] = parseCsv(csvContents);

if (
  headers.length !== REQUIRED_HEADERS.length ||
  headers.some((header, index) => header !== REQUIRED_HEADERS[index])
) {
  throw new Error(
    `OEM seed CSV headers must be exactly: ${REQUIRED_HEADERS.join(', ')}`,
  );
}

const seededCodes = new Set();

export const oemCatalog = dataRows
  .filter((row) => row.some((value) => value.trim()))
  .map((row, index) => {
    const rowNumber = index + 2;
    if (row.length !== REQUIRED_HEADERS.length) {
      throw new Error(
        `OEM seed row ${rowNumber} must contain ${REQUIRED_HEADERS.length} columns.`,
      );
    }

    const [
      ,
      rawCode,
      rawName,
      rawDisplayName,
      ,
      rawStatus,
      rawLogoUrl,
      rawWebsite,
      rawDescription,
    ] = row;
    const code = rawCode.trim().toUpperCase();
    const name = rawName.trim();
    const displayName = rawDisplayName.trim();
    const status = STATUS_MAP.get(rawStatus.trim());

    if (!code || !name || !displayName) {
      throw new Error(
        `OEM seed row ${rowNumber} requires OEM Code, OEM Name, and Display Name.`,
      );
    }
    if (seededCodes.has(code)) {
      throw new Error(`OEM seed has a duplicate OEM Code: ${code}`);
    }
    if (!status) {
      throw new Error(
        `OEM seed row ${rowNumber} has an unsupported Status: ${rawStatus}`,
      );
    }

    seededCodes.add(code);

    return {
      code,
      name,
      displayName,
      status,
      logoUrl: optionalUrl(rawLogoUrl, rowNumber, 'Logo'),
      website: optionalUrl(rawWebsite, rowNumber, 'Website'),
      description: rawDescription.trim() || null,
    };
  });
