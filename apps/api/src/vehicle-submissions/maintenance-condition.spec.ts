import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { maintenanceCondition } from './maintenance-condition.js';
import { MechanicReportDto } from './submission.dto.js';

const input = (): MechanicReportDto => ({
  stage: 'BASIC',
  fleetStatus: 'BROKEN',
  mechanicName: 'Mechanic',
  summary: 'Motor failure',
  safeForReuse: false,
  unsafeReason: 'Motor needs replacement',
  checksComplete: true,
  evidencePhotoIds: ['11111111-1111-4111-a111-111111111111'],
  items: [],
  issues: [
    {
      category: 'POWERTRAIN',
      description: ' Motor failure ',
      status: 'OPEN',
      evidencePhotoIds: ['11111111-1111-4111-a111-111111111111'],
    },
  ],
});
describe('submission maintenance conditions', () => {
  it('keeps issue IDs stable on retries and records a powertrain breakdown without a penalty', () => {
    const first = maintenanceCondition(input(), 'client:submission:key');
    expect(first).toEqual(
      maintenanceCondition(input(), 'client:submission:key'),
    );
    expect(first.issues[0]).toMatchObject({
      category: 'POWERTRAIN',
      description: 'Motor failure',
      status: 'OPEN',
    });
    expect(first.issues[0].issueId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('requires parts information for awaiting parts', () => {
    const dto = input();
    dto.fleetStatus = 'AWAITING_PARTS';
    expect(() => maintenanceCondition(dto, 'scope')).toThrow('required parts');
    dto.issues[0].requiredParts = 'Replacement controller';
    expect(maintenanceCondition(dto, 'scope').fleetStatus).toBe(
      'AWAITING_PARTS',
    );
  });
  it('blocks readiness until checks and every included issue are resolved', () => {
    const dto = input();
    dto.fleetStatus = 'AVAILABLE';
    dto.safeForReuse = true;
    expect(() => maintenanceCondition(dto, 'scope')).toThrow(
      'all issues resolved',
    );
    dto.issues[0].status = 'RESOLVED';
    expect(maintenanceCondition(dto, 'scope').fleetStatus).toBe('AVAILABLE');
    dto.checksComplete = false;
    expect(() => maintenanceCondition(dto, 'scope')).toThrow(
      'completed checks',
    );
  });
  it('requires explicit status, described issues and evidence', () => {
    const dto = input();
    dto.issues = [];
    expect(() => maintenanceCondition(dto, 'scope')).toThrow('described issue');
    const noProof = input();
    noProof.issues[0].evidencePhotoIds = [];
    expect(() => maintenanceCondition(noProof, 'scope')).toThrow('evidence');
  });
  it('validates enum fields, nested issues and mandatory report fields at the API boundary', async () => {
    expect(
      await validate(plainToInstance(MechanicReportDto, input())),
    ).toHaveLength(0);
    const bad = {
      ...input(),
      fleetStatus: 'MECHANICALLY_OK',
      issues: [{ category: 'UNKNOWN', status: 'DONE', description: '' }],
    };
    expect(
      (await validate(plainToInstance(MechanicReportDto, bad))).length,
    ).toBeGreaterThan(0);
  });
});
