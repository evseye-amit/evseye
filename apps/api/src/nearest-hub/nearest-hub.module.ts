import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { GoogleRoutesProvider, MapboxRoutingProvider, RoutingCache, RoutingOrchestrator, RoutingPolicyService, RoutingQuotaService, RoutingRedis } from './routing.js';
import { NearbyHubRepository, NearestHubController, NearestHubService } from './nearest-hub.js';
@Module({ imports: [AuthModule], controllers: [NearestHubController], providers: [GoogleRoutesProvider, MapboxRoutingProvider, RoutingRedis, RoutingQuotaService, RoutingCache, RoutingPolicyService, RoutingOrchestrator, NearbyHubRepository, NearestHubService] })
export class NearestHubModule {}
