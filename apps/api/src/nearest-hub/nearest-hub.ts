import { BadRequestException, Controller, Get, Injectable, Logger, NotFoundException, Query, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import type { Environment } from '../config/environment.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RoutingOrchestrator, type GeoPoint } from './routing.js';

type Candidate = { id: string; code: string; name: string; addressLine1: string | null; city: string; status: string; latitude: number; longitude: number; straightLineDistanceMeters: number };
@Injectable()
export class NearbyHubRepository {
  constructor(private readonly prisma: PrismaService) {}
  async find(clientId: string, origin: GeoPoint, radiusKm: number, limit: number): Promise<Candidate[]> {
    return this.prisma.$queryRaw<Candidate[]>(Prisma.sql`
      SELECT "id", "code", "name", "addressLine1", "city", "status"::text AS "status",
        "latitude"::double precision AS "latitude", "longitude"::double precision AS "longitude",
        ST_Distance("location", ST_SetSRID(ST_MakePoint(${origin.longitude}, ${origin.latitude}),4326)::geography) AS "straightLineDistanceMeters"
      FROM "Hub" WHERE "clientId" = ${clientId} AND "status" = 'ACTIVE'::"HubStatus" AND "deletedAt" IS NULL
        AND "location" IS NOT NULL
        AND ST_DWithin("location", ST_SetSRID(ST_MakePoint(${origin.longitude}, ${origin.latitude}),4326)::geography, ${radiusKm * 1000})
      ORDER BY "straightLineDistanceMeters" ASC LIMIT ${limit}`);
  }
}
@Injectable()
export class NearestHubService {
  private readonly logger = new Logger(NearestHubService.name);
  constructor(private readonly prisma: PrismaService, private readonly repo: NearbyHubRepository, private readonly routing: RoutingOrchestrator, private readonly config: ConfigService<Environment, true>) {}
  async nearby(userId: string, origin: GeoPoint, requestedRadius?: number, requestedLimit?: number) {
    if (!this.config.get('NEAREST_HUB_ENABLED')) throw new ServiceUnavailableException('Nearby hubs are unavailable.');
    const startedAt = Date.now();
    const rider = await this.prisma.rider.findFirst({ where: { userId, deletedAt: null }, select: { clientId: true } });
    if (!rider) throw new NotFoundException('Rider profile is unavailable.');
    const limit = Math.min(requestedLimit ?? this.config.get('NEAREST_HUB_RESULT_LIMIT'), this.config.get('NEAREST_HUB_RESULT_LIMIT'));
    const maxRadius = Math.min(requestedRadius ?? this.config.get('NEAREST_HUB_MAX_RADIUS_KM'), this.config.get('NEAREST_HUB_MAX_RADIUS_KM'));
    let candidates: Candidate[] = [];
    for (const step of this.config.get('NEAREST_HUB_RADIUS_STEPS_KM').split(',').map(Number)) {
      const radius = Math.min(step, maxRadius);
      candidates = await this.repo.find(rider.clientId, origin, radius, this.config.get('NEAREST_HUB_CANDIDATE_LIMIT'));
      if (candidates.length >= this.config.get('NEAREST_HUB_CANDIDATE_LIMIT') || radius >= maxRadius) break;
    }
    const routes = candidates.length ? await this.routing.routes(origin, candidates.map(hub => ({ id: hub.id, location: { latitude: hub.latitude, longitude: hub.longitude } }))) : [];
    const byId = new Map(routes.filter(route => route.status === 'SUCCESS' && Number.isFinite(route.durationSeconds)).map(route => [route.destinationId, route]));
    const routingAvailable = candidates.length > 0 && candidates.every(hub => byId.has(hub.id));
    candidates.sort((a, b) => routingAvailable
      ? (byId.get(a.id)!.durationSeconds! - byId.get(b.id)!.durationSeconds!) || ((byId.get(a.id)!.roadDistanceMeters ?? Infinity) - (byId.get(b.id)!.roadDistanceMeters ?? Infinity)) || a.straightLineDistanceMeters - b.straightLineDistanceMeters
      : a.straightLineDistanceMeters - b.straightLineDistanceMeters);
    const selected = candidates.slice(0, limit);
    this.logger.log(JSON.stringify({ event: 'nearest_hub_request', candidateCount: candidates.length, returnedCount: selected.length, routingAvailable, latencyMs: Date.now() - startedAt }));
    const providers = new Set(selected.map(hub => byId.get(hub.id)?.provider).filter(Boolean));
    return { location: origin, routingSource: routingAvailable && providers.size === 1 ? [...providers][0] : 'POSTGIS', hubs: selected.map(hub => {
      const route = routingAvailable ? byId.get(hub.id) : undefined;
      return { id: hub.id, code: hub.code, name: hub.name, address: [hub.addressLine1, hub.city].filter(Boolean).join(', '), location: { latitude: hub.latitude, longitude: hub.longitude }, distance: { straightLineMeters: Math.round(hub.straightLineDistanceMeters), roadMeters: route?.roadDistanceMeters ?? null }, travel: { durationSeconds: route?.durationSeconds ?? null, estimatedMinutes: route?.durationSeconds == null ? null : Math.ceil(route.durationSeconds / 60) }, status: hub.status, navigation: { latitude: hub.latitude, longitude: hub.longitude } };
    }), meta: { candidateCount: candidates.length, returnedCount: selected.length, routingAvailable } };
  }
}
@Controller('rider/hubs')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.RIDER)
export class NearestHubController {
  constructor(private readonly service: NearestHubService) {}
  @Get('nearby')
  async nearby(@CurrentUser() user: AuthUser, @Query('latitude') latitude: string, @Query('longitude') longitude: string, @Query('radiusKm') radius?: string, @Query('limit') limit?: string) {
    const lat = Number(latitude), lon = Number(longitude);
    if (!latitude || !longitude || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new BadRequestException('Invalid coordinates.');
    const radiusValue = radius === undefined ? undefined : Number(radius), limitValue = limit === undefined ? undefined : Number(limit);
    if ((radiusValue !== undefined && (!Number.isFinite(radiusValue) || radiusValue <= 0)) || (limitValue !== undefined && (!Number.isInteger(limitValue) || limitValue <= 0))) throw new BadRequestException('Invalid radius or limit.');
    return { data: await this.service.nearby(user.id, { latitude: lat, longitude: lon }, radiusValue, limitValue) };
  }
}
