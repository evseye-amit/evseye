import { describe, expect, it, vi } from 'vitest';
import { NearestHubService } from './nearest-hub.js';
import { RoutingOrchestrator, RoutingQuotaService } from './routing.js';

const origin = { latitude: 28.4595, longitude: 77.0266 };
const hub = (id: string, distance: number) => ({ id, code: id, name: id, addressLine1: null, city: 'Delhi', status: 'ACTIVE', latitude: 28.46, longitude: 77.03, straightLineDistanceMeters: distance });
const config = { get: (key: string) => ({ NEAREST_HUB_ENABLED: true, NEAREST_HUB_RESULT_LIMIT: 5, NEAREST_HUB_MAX_RADIUS_KM: 50, NEAREST_HUB_RADIUS_STEPS_KM: '5,10,25,50', NEAREST_HUB_CANDIDATE_LIMIT: 10 } as Record<string, unknown>)[key] };
describe('nearest hub client isolation', () => {
  it('passes only the authenticated Rider client to every spatial query', async () => {
    const repo = { find: vi.fn().mockResolvedValue([hub('client-a-hub', 5000)]) };
    const service = new NearestHubService({ rider: { findFirst: vi.fn().mockResolvedValue({ clientId: 'client-a' }) } } as never, repo as never, { routes: vi.fn().mockResolvedValue([]) } as never, config as never);
    const result = await service.nearby('user-a', origin);
    expect(repo.find).toHaveBeenCalledWith('client-a', origin, expect.any(Number), 10);
    expect(result.hubs.map(h => h.id)).toEqual(['client-a-hub']);
    expect(result.routingSource).toBe('POSTGIS');
    expect(result.hubs[0].travel.durationSeconds).toBeNull();
  });
  it('does not route an empty candidate set', async () => {
    const routes = vi.fn();
    const service = new NearestHubService({ rider: { findFirst: vi.fn().mockResolvedValue({ clientId: 'client-a' }) } } as never, { find: vi.fn().mockResolvedValue([]) } as never, { routes } as never, config as never);
    expect((await service.nearby('user-a', origin)).hubs).toEqual([]);
    expect(routes).not.toHaveBeenCalled();
  });
});

describe('routing quota', () => {
  it('uses atomic Lua reservation and respects required units', async () => {
    let usage = 11995;
    const redis = { command: vi.fn(async (args: (string | number)[]) => { if (args[0] === 'EVAL') { const units = Number(args[4]); const limit = Number(args[5]); if (usage + units > limit) return '0'; usage += units; return '1'; } return String(usage); }) };
    const quota = new RoutingQuotaService({ get: (key: string) => ({ ROUTING_QUOTA_TIMEZONE: 'Asia/Kolkata', GOOGLE_ROUTES_MONTHLY_LIMIT: 12000, MAPBOX_ROUTES_MONTHLY_LIMIT: 15000 } as Record<string, unknown>)[key] } as never, redis as never, {} as never);
    const reserved = await Promise.all(Array.from({ length: 10 }, () => quota.reserve('GOOGLE', 1)));
    expect(reserved.filter(Boolean)).toHaveLength(5);
    expect(usage).toBe(12000);
    expect(redis.command).toHaveBeenCalledWith(expect.arrayContaining(['EVAL', expect.any(String)]));
  });
});

describe('routing failover and cache', () => {
  it('tries Mapbox after Google failure and caches the successful matrix', async () => {
    let cached: unknown = null;
    const google = { type: 'GOOGLE', estimateUsageUnits: () => 1, calculateRoutes: vi.fn().mockRejectedValue(new Error('timeout')) };
    const mapbox = { type: 'MAPBOX', estimateUsageUnits: () => 1, calculateRoutes: vi.fn().mockResolvedValue([{ destinationId: 'h', provider: 'MAPBOX', roadDistanceMeters: 2000, durationSeconds: 300, status: 'SUCCESS' }]) };
    const cache = { get: vi.fn(async () => cached), set: vi.fn(async (_origin, _destination, route) => { cached = route; }) };
    const quota = { reserve: vi.fn().mockResolvedValue(true), record: vi.fn().mockResolvedValue(undefined) };
    const routing = new RoutingOrchestrator(cache as never, { providers: () => [google, mapbox], success: vi.fn(), failure: vi.fn() } as never, quota as never);
    const destinations = [{ id: 'h', location: origin }];
    expect((await routing.routes(origin, destinations))[0].provider).toBe('MAPBOX');
    await routing.routes(origin, destinations);
    expect(google.calculateRoutes).toHaveBeenCalledTimes(1);
    expect(mapbox.calculateRoutes).toHaveBeenCalledTimes(1);
    expect(quota.reserve).toHaveBeenCalledTimes(2);
  });
});
