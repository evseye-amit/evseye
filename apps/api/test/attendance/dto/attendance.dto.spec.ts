import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  AddAttendancePeriodDto,
  CorrectAttendancePeriodDto,
} from '../../../src/attendance/dto/attendance.dto.js';

describe('attendance DTOs', () => {
  it('rejects blank or overlong reasons', async () => {
    const checkOutAt = new Date(Date.now() - 60_000).toISOString();
    const checkInAt = new Date(Date.now() - 120_000).toISOString();
    const blank = await validate(
      plainToInstance(AddAttendancePeriodDto, {
        checkInAt,
        checkOutAt,
        reason: '   ',
      }),
    );
    const long = await validate(
      plainToInstance(AddAttendancePeriodDto, {
        checkInAt,
        checkOutAt,
        reason: 'x'.repeat(501),
      }),
    );
    expect(blank).not.toHaveLength(0);
    expect(long).not.toHaveLength(0);
  });

  it('rejects null correction timestamps while allowing an omitted timestamp', async () => {
    const omitted = await validate(
      plainToInstance(CorrectAttendancePeriodDto, { reason: 'Fix' }),
    );
    const nullable = await validate(
      plainToInstance(CorrectAttendancePeriodDto, {
        checkOutAt: null,
        reason: 'Fix',
      }),
    );
    expect(omitted).toHaveLength(0);
    expect(nullable).not.toHaveLength(0);
  });
});
