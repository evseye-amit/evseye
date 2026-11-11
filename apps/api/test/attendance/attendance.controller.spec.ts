import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { AttendanceAdminController } from '../../src/attendance/attendance-admin.controller.js';
import { AttendanceController } from '../../src/attendance/attendance.controller.js';
import { ROLES_KEY } from '../../src/auth/decorators/roles.decorator.js';

describe('attendance controller boundaries', () => {
  it('restricts admin routes to client administrators', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AttendanceAdminController)).toEqual([
      UserRole.CLIENT_ADMIN,
    ]);
    expect(
      Reflect.getMetadata(ROLES_KEY, AttendanceController),
    ).toBeUndefined();
  });

  it('keeps route guards on both attendance surfaces', () => {
    const reflector = new Reflector();
    expect(reflector.get('__guards__', AttendanceController)).toBeDefined();
    expect(
      reflector.get('__guards__', AttendanceAdminController),
    ).toBeDefined();
  });
});
