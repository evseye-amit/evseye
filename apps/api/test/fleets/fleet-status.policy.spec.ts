import { FleetStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { FleetStatusPolicy } from '../../src/fleets/fleet-status.policy.js';

describe('FleetStatusPolicy', () => {
  const policy = new FleetStatusPolicy();
  const pendingActivation = 'PENDING_ACTIVATION' as FleetStatus;

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

  it('requires receipt before a fleet can leave transit', () => {
    expect(() =>
      policy.assertTransition(FleetStatus.IN_TRANSIT, pendingActivation),
    ).not.toThrow();
  });

  it('does not allow generic status changes to activate a fleet', () => {
    expect(() =>
      policy.assertTransition(FleetStatus.IN_TRANSIT, FleetStatus.AVAILABLE),
    ).toThrow('Fleet cannot transition');
    expect(() =>
      policy.assertTransition(pendingActivation, FleetStatus.AVAILABLE),
    ).toThrow('Fleet cannot transition');
  });

  it('allows inactive maintenance recovery back to pending activation', () => {
    expect(() =>
      policy.assertTransition(FleetStatus.MAINTENANCE, pendingActivation),
    ).not.toThrow();
  });
});
