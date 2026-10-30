import { ROLES_KEY } from '../../src/auth/decorators/roles.decorator.js';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  FleetSearchController,
  FleetSearchQueryDto,
} from '../../src/allocations/fleet-search.controller.js';
import { FleetManagerActionGuard } from '../../src/auth/guards/fleet-manager-action.guard.js';
import { FleetsController } from '../../src/fleets/fleets.controller.js';
import { MediaController } from '../../src/media/media.controller.js';
import { InspectionsController } from '../../src/inspections/inspections.controller.js';

describe('Fleet search HTTP boundary', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const metadata = { type: 'query' as const, metatype: FleetSearchQueryDto };
  it('defaults and validates pagination and optional status/hub filters', async () => {
    await expect(pipe.transform({}, metadata)).resolves.toMatchObject({
      page: 1,
      limit: 25,
    });
    await expect(
      pipe.transform(
        { search: 'DL01', page: '2', limit: '10', status: 'AVAILABLE' },
        metadata,
      ),
    ).resolves.toMatchObject({ search: 'DL01', page: 2, limit: 10 });
    for (const input of [
      { limit: '101' },
      { page: '0' },
      { status: 'not-a-status' },
      { hubId: 'invalid' },
      { search: 'x'.repeat(101) },
      { clientId: 'foreign' },
    ])
      await expect(pipe.transform(input, metadata)).rejects.toThrow();
  });
  it('keeps global search Fleet Manager only and action guards attached to existing mutation controllers', () => {
    expect(Reflect.getMetadata(ROLES_KEY, FleetSearchController)).toEqual([
      'FLEET_MANAGER',
    ]);
    for (const controller of [
      FleetsController,
      MediaController,
      InspectionsController,
    ])
      expect(Reflect.getMetadata('__guards__', controller)).toContain(
        FleetManagerActionGuard,
      );
  });
});
