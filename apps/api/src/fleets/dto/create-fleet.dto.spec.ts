import { FleetStatus } from '@prisma/client';
import { validate } from 'class-validator';
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { CreateFleetDto } from './create-fleet.dto.js';

describe('CreateFleetDto status', () => {
  it('accepts pending activation but rejects in-transit creation', async () => {
    const errors = await validate(
      Object.assign(new CreateFleetDto(), {
        status: FleetStatus.PENDING_ACTIVATION,
      }),
    );
    expect(errors.find((error) => error.property === 'status')).toBeUndefined();

    const inTransitErrors = await validate(
      Object.assign(new CreateFleetDto(), { status: FleetStatus.IN_TRANSIT }),
    );
    expect(
      inTransitErrors.find((error) => error.property === 'status'),
    ).toMatchObject({ property: 'status' });

    const availableErrors = await validate(
      Object.assign(new CreateFleetDto(), { status: FleetStatus.AVAILABLE }),
    );
    expect(availableErrors.find((error) => error.property === 'status')).toMatchObject({
      property: 'status',
    });
  });
});
