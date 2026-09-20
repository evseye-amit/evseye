import { ClientIdentityModule } from './client-identity/client-identity.module.js';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { type Environment, validateEnvironment } from './config/environment.js';
import { HealthModule } from './health/health.module.js';
import { MediaModule } from './media/media.module.js';
import { KycModule } from './kyc/kyc.module.js';
import { FleetsModule } from './fleets/fleets.module.js';
import { LocationsModule } from './locations/locations.module.js';
import { AllocationsModule } from './allocations/allocations.module.js';
import { InspectionsModule } from './inspections/inspections.module.js';
import { IotModule } from './iot/iot.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { AuditModule } from './audit/audit.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RidersModule } from './riders/riders.module.js';
import { PlatformAdminModule } from './platform-admin/platform-admin.module.js';
import { PlatformCatalogModule } from './platform-catalog/platform-catalog.module.js';
import { ClientOnboardingModule } from './client-onboarding/client-onboarding.module.js';
import { ClientUsersModule } from './client-users/client-users.module.js';
import { CommercialModule } from './commercial/commercial.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) => [
        {
          ttl: config.getOrThrow<number>('API_RATE_TTL_MS'),
          limit: config.getOrThrow<number>('API_RATE_LIMIT'),
        },
      ],
    }),
    PrismaModule,
    ClientIdentityModule,
    AuthModule,
    RidersModule,
    PlatformAdminModule,
    PlatformCatalogModule,
    ClientOnboardingModule,
    ClientUsersModule,
    CommercialModule,
    MediaModule,
    KycModule,
    FleetsModule,
    LocationsModule,
    AllocationsModule,
    InspectionsModule,
    IotModule,
    DashboardModule,
    AuditModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
