import { describe, expect, it } from 'vitest';
import { importFailuresToCsv, normalizeImportFailures } from '../../src/imports/import-failure.js';

describe('importFailuresToCsv', () => {
  it('serializes original row columns and failure metadata without wrapper fields', () => {
    const failures = normalizeImportFailures([
      { vehicleNumber: 'EV,"1', chassisNumber: 'CH-1', row_number: 2, failure_reason: 'Already exists.' },
      { vehicleNumber: 'EV-2', chassisNumber: 'CH-2', row_number: 3, failure_reason: 'Missing hub.' },
    ]);

    expect(importFailuresToCsv(failures)).toBe([
      'vehicleNumber,chassisNumber,row_number,failure_reason',
      '"EV,""1","CH-1","2","Already exists."',
      '"EV-2","CH-2","3","Missing hub."',
    ].join('\n'));
    expect(importFailuresToCsv(failures)).not.toContain('[object Object]');
    expect(importFailuresToCsv([])).toBe('');
  });

  it('uses the preserved raw row when input is already normalized', () => {
    expect(importFailuresToCsv([{
      row: 2,
      message: 'Invalid row.',
      fields: [],
      raw: { vehicleNumber: 'EV-1', failure_reason: 'Invalid row.' },
    }])).toBe('vehicleNumber,failure_reason\n"EV-1","Invalid row."');
  });
});
