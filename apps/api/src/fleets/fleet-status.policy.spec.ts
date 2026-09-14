import { FleetStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { FleetStatusPolicy } from './fleet-status.policy.js';

describe('FleetStatusPolicy', () => {
  const policy = new FleetStatusPolicy();

  it('permits an available fleet reservation', () => {
    expect(() =>
      policy.assertTransition(FleetStatus.AVAILABLE, FleetStatus.RESERVED),
    ).not.toThrow();
  });

  it('rejects an invalid direct allocation', () => {
    expect(() =>
      policy.assertTransition(FleetStatus.AVAILABLE, FleetStatus.ALLOCATED),
    ).toThrow('Fleet cannot transition');
  });
});
