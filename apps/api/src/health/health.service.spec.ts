import { describe, expect, it } from 'vitest';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  const service = new HealthService({
    $queryRaw: async () => 1,
  } as never);

  it('reports a live service', () => {
    expect(service.liveness()).toEqual({
      data: { status: 'ok', service: 'evs-eye-api' },
    });
  });

  it('reports readiness when the database is reachable', async () => {
    await expect(service.readiness()).resolves.toMatchObject({ status: 'ready' });
  });
});
