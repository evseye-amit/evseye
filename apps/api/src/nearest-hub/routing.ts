import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { createConnection, type Socket } from 'node:net';
import { connect as connectTls, type TLSSocket } from 'node:tls';

export type ProviderType = 'GOOGLE' | 'MAPBOX' | 'POSTGIS';
export type GeoPoint = { latitude: number; longitude: number };
export type Destination = { id: string; location: GeoPoint };
export type Route = { destinationId: string; provider: ProviderType; roadDistanceMeters: number | null; durationSeconds: number | null; status: 'SUCCESS' | 'NO_ROUTE' | 'FAILED' };
export interface RoutingProvider {
  readonly type: 'GOOGLE' | 'MAPBOX';
  enabled(): boolean;
  estimateUsageUnits(destinations: Destination[]): number;
  calculateRoutes(origin: GeoPoint, destinations: Destination[]): Promise<Route[]>;
}

function waypoint(point: GeoPoint) { return { waypoint: { location: { latLng: { latitude: point.latitude, longitude: point.longitude } } } }; }
@Injectable()
export class GoogleRoutesProvider implements RoutingProvider {
  readonly type = 'GOOGLE';
  constructor(private readonly config: ConfigService<Environment, true>) {}
  enabled() { return this.config.get('GOOGLE_ROUTES_ENABLED') && !!this.config.get('GOOGLE_ROUTES_API_KEY'); }
  estimateUsageUnits(destinations: Destination[]) { return destinations.length; }
  async calculateRoutes(origin: GeoPoint, destinations: Destination[]): Promise<Route[]> {
    const response = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
      method: 'POST', signal: AbortSignal.timeout(this.config.get('GOOGLE_ROUTES_TIMEOUT_MS')),
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': this.config.get('GOOGLE_ROUTES_API_KEY')!, 'X-Goog-FieldMask': 'originIndex,destinationIndex,status,condition,distanceMeters,duration' },
      body: JSON.stringify({ origins: [waypoint(origin)], destinations: destinations.map(d => waypoint(d.location)), travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE' }),
    });
    if (!response.ok) throw new Error(`Google Routes HTTP ${response.status}`);
    const elements = await response.json() as { destinationIndex: number; condition?: string; status?: { code?: number }; distanceMeters?: number; duration?: string }[];
    if (!Array.isArray(elements)) throw new Error('Invalid Google route matrix');
    return destinations.map((destination, index) => {
      const element = elements.find(e => e.destinationIndex === index);
      const success = element?.condition === 'ROUTE_EXISTS' && !element.status?.code;
      return { destinationId: destination.id, provider: this.type, roadDistanceMeters: success ? element?.distanceMeters ?? null : null, durationSeconds: success ? Number(element?.duration?.replace('s', '')) : null, status: success ? 'SUCCESS' : 'NO_ROUTE' };
    });
  }
}
@Injectable()
export class MapboxRoutingProvider implements RoutingProvider {
  readonly type = 'MAPBOX';
  constructor(private readonly config: ConfigService<Environment, true>) {}
  enabled() { return this.config.get('MAPBOX_ROUTES_ENABLED') && !!this.config.get('MAPBOX_ACCESS_TOKEN'); }
  estimateUsageUnits(destinations: Destination[]) { return destinations.length; }
  async calculateRoutes(origin: GeoPoint, destinations: Destination[]): Promise<Route[]> {
    const points = [origin, ...destinations.map(d => d.location)].map(p => `${p.longitude},${p.latitude}`).join(';');
    const url = new URL(`https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${points}`);
    url.searchParams.set('sources', '0'); url.searchParams.set('destinations', destinations.map((_, i) => i + 1).join(';'));
    url.searchParams.set('annotations', 'duration,distance'); url.searchParams.set('access_token', this.config.get('MAPBOX_ACCESS_TOKEN')!);
    const response = await fetch(url, { signal: AbortSignal.timeout(this.config.get('MAPBOX_ROUTES_TIMEOUT_MS')) });
    if (!response.ok) throw new Error(`Mapbox Matrix HTTP ${response.status}`);
    const matrix = await response.json() as { code?: string; durations?: (number | null)[][]; distances?: (number | null)[][] };
    if (matrix.code !== 'Ok' || !matrix.durations?.[0]) throw new Error('Invalid Mapbox route matrix');
    return destinations.map((destination, index) => ({ destinationId: destination.id, provider: this.type, roadDistanceMeters: matrix.distances?.[0]?.[index] ?? null, durationSeconds: matrix.durations?.[0]?.[index] ?? null, status: matrix.durations?.[0]?.[index] == null ? 'NO_ROUTE' : 'SUCCESS' }));
  }
}

// Minimal RESP client; one short-lived connection per operation, so reservations remain atomic across API instances.
@Injectable()
export class RoutingRedis {
  constructor(private readonly config: ConfigService<Environment, true>) {}
  async command(args: (string | number)[]): Promise<string | null> {
    const url = new URL(this.config.get('REDIS_URL')!);
    const socket: Socket | TLSSocket = url.protocol === 'rediss:' ? connectTls({ host: url.hostname, port: Number(url.port || 6379) }) : createConnection({ host: url.hostname, port: Number(url.port || 6379) });
    try {
      await new Promise<void>((resolve, reject) => { socket.once(url.protocol === 'rediss:' ? 'secureConnect' : 'connect', resolve); socket.once('error', reject); });
      const send = async (parts: (string | number)[]) => {
        const encoded = `*${parts.length}\r\n` + parts.map(part => { const value = String(part); return `$${Buffer.byteLength(value)}\r\n${value}\r\n`; }).join('');
        return await new Promise<string | null>((resolve, reject) => {
          let data = Buffer.alloc(0);
          const onData = (chunk: Buffer) => {
            data = Buffer.concat([data, chunk]); const lineEnd = data.indexOf('\r\n'); if (lineEnd < 0) return;
            const prefix = String.fromCharCode(data[0]); const line = data.subarray(1, lineEnd).toString();
            if (prefix === '$') { const length = Number(line); if (length >= 0 && data.length < lineEnd + 2 + length + 2) return; cleanup(); resolve(length < 0 ? null : data.subarray(lineEnd + 2, lineEnd + 2 + length).toString()); }
            else { cleanup(); if (prefix === '-') reject(new Error(line)); else resolve(line); }
          };
          const onError = (error: Error) => { cleanup(); reject(error); };
          const cleanup = () => { socket.off('data', onData); socket.off('error', onError); };
          socket.on('data', onData); socket.once('error', onError); socket.write(encoded);
        });
      };
      if (url.password) await send(['AUTH', decodeURIComponent(url.password)]);
      if (url.pathname && url.pathname !== '/') await send(['SELECT', Number(url.pathname.slice(1))]);
      return await send(args);
    } finally { socket.destroy(); }
  }
}

const RESERVE = `local current=tonumber(redis.call('GET',KEYS[1]) or '0'); local units=tonumber(ARGV[1]); if current+units>tonumber(ARGV[2]) then return 0 end; redis.call('INCRBY',KEYS[1],units); redis.call('EXPIRE',KEYS[1],ARGV[3]); return 1`;
@Injectable()
export class RoutingQuotaService {
  constructor(private readonly config: ConfigService<Environment, true>, private readonly redis: RoutingRedis, private readonly prisma: PrismaService) {}
  month() { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: this.config.get('ROUTING_QUOTA_TIMEZONE'), year: 'numeric', month: '2-digit' }).formatToParts(new Date()); return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}`; }
  limit(provider: 'GOOGLE' | 'MAPBOX') { return provider === 'GOOGLE' ? this.config.get('GOOGLE_ROUTES_MONTHLY_LIMIT') : this.config.get('MAPBOX_ROUTES_MONTHLY_LIMIT'); }
  key(provider: 'GOOGLE' | 'MAPBOX', month = this.month()) { return `evseye:routing:quota:${provider}:${month}`; }
  async usage(provider: 'GOOGLE' | 'MAPBOX', month = this.month()) { return Number(await this.redis.command(['GET', this.key(provider, month)]) ?? 0); }
  async reserve(provider: 'GOOGLE' | 'MAPBOX', units: number) { return await this.redis.command(['EVAL', RESERVE, 1, this.key(provider), units, this.limit(provider), 7776000]) === '1'; }
  async release(provider: 'GOOGLE' | 'MAPBOX', units: number) { await this.redis.command(['DECRBY', this.key(provider), units]); }
  async record(provider: 'GOOGLE' | 'MAPBOX', units: number, success: boolean) {
    await this.prisma.routingProviderUsage.upsert({ where: { provider_billingMonth: { provider, billingMonth: this.month() } }, create: { provider, billingMonth: this.month(), requestCount: 1, usageUnits: units, successCount: success ? 1 : 0, failureCount: success ? 0 : 1 }, update: { requestCount: { increment: 1 }, usageUnits: { increment: units }, successCount: { increment: success ? 1 : 0 }, failureCount: { increment: success ? 0 : 1 } } });
  }
  async getMonthlyRoutingUsage() { const billingMonth = this.month(); return { billingMonth, providers: await Promise.all((['GOOGLE', 'MAPBOX'] as const).map(async provider => { const used = await this.usage(provider); const limit = this.limit(provider); return { provider, used, limit, remaining: Math.max(0, limit - used), percentageUsed: limit ? Math.round(used / limit * 10000) / 100 : 100 }; })) }; }
}

@Injectable()
export class RoutingCache {
  constructor(private readonly redis: RoutingRedis, private readonly config: ConfigService<Environment, true>) {}
  key(origin: GeoPoint, destination: Destination) { return `evseye:routing:route:driving:${origin.latitude.toFixed(4)}:${origin.longitude.toFixed(4)}:${destination.id}:${destination.location.latitude.toFixed(5)}:${destination.location.longitude.toFixed(5)}`; }
  async get(origin: GeoPoint, destination: Destination): Promise<Route | null> { if (!this.config.get('ROUTING_CACHE_ENABLED')) return null; const value = await this.redis.command(['GET', this.key(origin, destination)]); return value ? JSON.parse(value) as Route : null; }
  async set(origin: GeoPoint, destination: Destination, route: Route) { if (this.config.get('ROUTING_CACHE_ENABLED') && route.status === 'SUCCESS') await this.redis.command(['SET', this.key(origin, destination), JSON.stringify(route), 'EX', this.config.get('ROUTING_CACHE_TTL_SECONDS')]); }
}

@Injectable()
export class RoutingPolicyService {
  private readonly unhealthyUntil = new Map<string, number>();
  private readonly failures = new Map<string, number>();
  constructor(private readonly config: ConfigService<Environment, true>, private readonly google: GoogleRoutesProvider, private readonly mapbox: MapboxRoutingProvider) {}
  providers() { const all = { GOOGLE: this.google, MAPBOX: this.mapbox }; return this.config.get('ROUTING_PROVIDER_ORDER').split(',').map((name: string) => all[name as keyof typeof all]).filter((p: RoutingProvider | undefined): p is RoutingProvider => !!p && p.enabled() && (this.unhealthyUntil.get(p.type) ?? 0) < Date.now()); }
  success(type: string) { this.failures.delete(type); this.unhealthyUntil.delete(type); }
  failure(type: string) { const count = (this.failures.get(type) ?? 0) + 1; this.failures.set(type, count); if (count >= 3) { this.unhealthyUntil.set(type, Date.now() + 30000); this.failures.delete(type); } }
}

@Injectable()
export class RoutingOrchestrator {
  private readonly logger = new Logger(RoutingOrchestrator.name);
  private readonly inflight = new Map<string, Promise<Route[]>>();
  constructor(private readonly cache: RoutingCache, private readonly policy: RoutingPolicyService, private readonly quota: RoutingQuotaService) {}
  async routes(origin: GeoPoint, destinations: Destination[]): Promise<Route[]> {
    const key = `${origin.latitude.toFixed(4)}:${origin.longitude.toFixed(4)}:${destinations.map(d => d.id).join(',')}`;
    const existing = this.inflight.get(key); if (existing) return existing;
    const promise = this.resolve(origin, destinations).finally(() => this.inflight.delete(key)); this.inflight.set(key, promise); return promise;
  }
  private async resolve(origin: GeoPoint, destinations: Destination[]): Promise<Route[]> {
    let cached: (Route | null)[];
    try { cached = await Promise.all(destinations.map(d => this.cache.get(origin, d))); } catch { return []; }
    const missing = destinations.filter((_, index) => !cached[index]);
    this.logger.log(JSON.stringify({ event: 'routing_cache', hits: destinations.length - missing.length, misses: missing.length }));
    if (!missing.length) return cached as Route[];
    for (const provider of this.policy.providers()) {
      const units = provider.estimateUsageUnits(missing);
      let reserved = false;
      try { reserved = await this.quota.reserve(provider.type, units); } catch { return cached.filter((route): route is Route => !!route); }
      if (!reserved) { this.logger.warn(JSON.stringify({ event: 'routing_quota_exhausted', provider: provider.type, units })); continue; }
      try {
        const startedAt = Date.now();
        const routes = await provider.calculateRoutes(origin, missing);
        this.logger.log(JSON.stringify({ event: 'routing_external_call', provider: provider.type, units, latencyMs: Date.now() - startedAt, success: true }));
        await this.quota.record(provider.type, units, true).catch(() => undefined);
        this.policy.success(provider.type);
        await Promise.all(routes.map((route: Route, index: number) => this.cache.set(origin, missing[index], route).catch(() => undefined)));
        return [...cached.filter((route): route is Route => !!route), ...routes];
      } catch {
        // Once fetch was attempted, the provider may have billed the matrix; retain the reservation.
        await this.quota.record(provider.type, units, false).catch(() => undefined);
        this.policy.failure(provider.type);
        this.logger.warn(JSON.stringify({ event: 'routing_provider_failure', provider: provider.type, units }));
      }
    }
    this.logger.warn(JSON.stringify({ event: 'routing_fallback', reason: 'NO_EXTERNAL_ROUTE' }));
    return cached.filter((route): route is Route => !!route);
  }
}
