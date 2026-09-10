import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module.js';
import { validateEnvironment } from './config/environment.js';
import { HealthModule } from './health/health.module.js';
import { MediaModule } from './media/media.module.js';
import { KycModule } from './kyc/kyc.module.js';
import { FleetsModule } from './fleets/fleets.module.js';
import { LocationsModule } from './locations/locations.module.js';
import { AllocationsModule } from './allocations/allocations.module.js';
import { InspectionsModule } from './inspections/inspections.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RidersModule } from './riders/riders.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    PrismaModule,
    AuthModule,
    RidersModule,
    MediaModule,
    KycModule,
    FleetsModule,
    LocationsModule,
    AllocationsModule,
    InspectionsModule,
    HealthModule,
  ],
})
export class AppModule {}
