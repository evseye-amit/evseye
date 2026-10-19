import { PaymentTransactionsModule } from './payment-transactions/payment-transactions.module.js';
import { FleetManagerMaintenanceModule } from './fleet-manager-maintenance/maintenance.module.js';
import { FleetManagerHomeModule } from './fleet-manager-home/home.module.js';
import { NotificationModule } from './notifications/notification.module.js';
import { VehicleSubmissionModule } from './vehicle-submissions/submission.module.js';
import { WalletModule } from './wallet/wallet.module.js';
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
import { SparesModule } from './spares/spares.module.js';
import { FleetReadinessModule } from './fleet-readiness/readiness.module.js';
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
import { ReferralModule } from './referrals/referral.module.js';
import { RiderBillingModule } from './rider-billing/rider-billing.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { RiderRateCardsModule } from './rider-rate-cards/rider-rate-cards.module.js';
import { NearestHubModule } from './nearest-hub/nearest-hub.module.js';
import { CollectionsModule } from './collections/collections.module.js';
import { FinalSettlementModule } from './final-settlement/final-settlement.module.js';
import { RewardsModule } from './rewards/rewards.module.js';
import { LegalModule } from './legal/legal.module.js';
import { RideReturnsModule } from './ride-returns/ride-returns.module.js';
import { SupportModule } from './support/support.module.js';
import { AttendanceModule } from './attendance/attendance.module.js';
import { BanksModule } from './banks/banks.module.js';
import { WorkPartnersModule } from './work-partners/work-partners.module.js';

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
    WorkPartnersModule,
    ClientOnboardingModule,
    ClientUsersModule,
    CommercialModule,
    ReferralModule,
    RiderBillingModule,
    WalletModule,
    RewardsModule,
    LegalModule,
    RideReturnsModule,
    VehicleSubmissionModule,
    SupportModule,
    AttendanceModule,
    BanksModule,
    NotificationModule,
    PaymentsModule,
    PaymentTransactionsModule,
    CollectionsModule,
    FinalSettlementModule,
    NearestHubModule,
    RiderRateCardsModule,
    MediaModule,
    KycModule,
    FleetsModule,
    FleetReadinessModule,
    SparesModule,
    LocationsModule,
    AllocationsModule,
    InspectionsModule,
    IotModule,
    DashboardModule,
    FleetManagerHomeModule,
    FleetManagerMaintenanceModule,
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
