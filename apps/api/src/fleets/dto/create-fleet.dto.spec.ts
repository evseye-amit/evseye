import { FleetStatus } from '@prisma/client';
import { validate } from 'class-validator';
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { CreateFleetDto } from './create-fleet.dto.js';

describe('CreateFleetDto status', () => {
  it('accepts only pending activation or in-transit as an initial status', async () => {
    for (const status of [
      FleetStatus.PENDING_ACTIVATION,
      FleetStatus.IN_TRANSIT,
    ]) {
      const errors = await validate(
        Object.assign(new CreateFleetDto(), { status }),
      );
      expect(
        errors.find((error) => error.property === 'status'),
      ).toBeUndefined();
    }

    const errors = await validate(
      Object.assign(new CreateFleetDto(), { status: FleetStatus.AVAILABLE }),
    );
    expect(errors.find((error) => error.property === 'status')).toMatchObject({
      property: 'status',
    });
  });
});
