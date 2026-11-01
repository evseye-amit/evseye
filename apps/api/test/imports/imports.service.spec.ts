import { ImportEntityType, ImportScope } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { ImportsService } from '../../src/imports/imports.service.js';

describe('ImportsService platform failure round trips', () => {
  it('keeps original raw columns when normalized failures are stored and read again', async () => {
    const update = vi.fn().mockResolvedValue({
      id: 'job-1', entityType: ImportEntityType.VEHICLE_TYPE, scope: ImportScope.PLATFORM,
      status: 'PARTIAL_PASS', totalRows: 1, passedRows: 0, failedRows: 1,
    });
    const findFirst = vi.fn();
    const service = new ImportsService({ importJob: { update, findFirst } } as never);
    const original = { categoryCode: 'CAT-1', code: 'TYPE-1', row_number: 2, failure_reason: 'Duplicate.' };

    await service.completePlatformJob('job-1', { passedRows: 0, failures: [original] });
    const stored = update.mock.calls[0]![0].data.metadata as { failures: Array<Record<string, unknown>> };
    expect(stored.failures[0]!.raw).toEqual(original);

    findFirst.mockResolvedValue({ metadata: stored });
    const failures = await service.platformFailures('job-1', ImportEntityType.VEHICLE_TYPE);
    expect(failures[0]!.raw).toEqual(original);
  });
});
