import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { UserRole } from '@prisma/client';
import { LocationsController } from '../../src/locations/locations.controller.js';
import { ROLES_KEY } from '../../src/auth/decorators/roles.decorator.js';

describe('LocationsController authorization', () => {
  it('restricts hub mutations to Client Admin while preserving read access', () => {
    expect(Reflect.getMetadata(ROLES_KEY, LocationsController)).toEqual([
      UserRole.CLIENT_ADMIN,
      UserRole.FLEET_MANAGER,
    ]);
    for (const method of ['createHub', 'updateHub', 'deleteHub', 'bulkHubs']) {
      const handler = (LocationsController.prototype as unknown as Record<string, object>)[method];
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
        UserRole.CLIENT_ADMIN,
      ]);
    }
  });
});
