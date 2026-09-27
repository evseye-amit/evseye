import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { KycController } from './kyc.controller.js';
import { KycService } from './kyc.service.js';
import { KYC_PROVIDER } from './providers/kyc-provider.interface.js';
import { ManualKycProvider } from './providers/manual-kyc.provider.js';
import { ReferralModule } from '../referrals/referral.module.js';
import { VerificationController } from './verification/verification.controller.js';
import { VerificationService } from './verification/verification.service.js';
import { ProviderRegistryService } from './verification/provider-registry.service.js';
import { SandboxHttpService } from './verification/sandbox-http.service.js';
import { SandboxVerificationProvider } from './verification/sandbox-verification.provider.js';
import { VerificationAdminController } from './verification/verification-admin.controller.js';
import { KycWorkflowController, KycWorkflowAdminController } from './workflow/kyc-workflow.controller.js';
import { KycWorkflowEngine } from './workflow/kyc-workflow.service.js';
import { KycDecisionEngine } from './workflow/kyc-decision.service.js';
import { KycNameMatchService, KycReconciliationEngine } from './workflow/kyc-reconciliation.service.js';
import { KycRoutingEngine } from './routing/kyc-routing.engine.js';
import { KycResultArbitrator } from './routing/kyc-result-arbitrator.js';
import { KycProviderHealthService } from './routing/kyc-provider-health.service.js';
import { KycRoutingAdminController } from './routing/kyc-routing-admin.controller.js';
import { KycCommercialService } from './commercial/kyc-commercial.service.js';
import { KycCommercialAdminController } from './commercial/kyc-commercial-admin.controller.js';
import { KycPlatformCommercialController } from './commercial/kyc-platform-commercial.controller.js';
import { KycStuckDetectionService } from './operations/kyc-stuck-detection.service.js';
import { KycOperationsQueryService } from './operations/kyc-operations-query.service.js';
import { KycOperationsCommandService } from './operations/kyc-operations-command.service.js';
import { KycOperationalAlertService } from './operations/kyc-operational-alert.service.js';
import { KycClientOperationsController, KycPlatformOperationsController } from './operations/kyc-operations.controller.js';
import { KycClientAnalyticsController, KycPlatformAnalyticsController } from './analytics/kyc-analytics.controller.js';
import { KycAnalyticsQueryService } from './analytics/kyc-analytics-query.service.js';
import { KycAnalyticsService } from './analytics/kyc-analytics.service.js';
import { KycSlaAnalyticsService } from './analytics/kyc-sla-analytics.service.js';
import { KycProviderScoringService } from './routing/kyc-provider-scoring.service.js';
import { KycIntelligentRoutingService } from './routing/kyc-intelligent-routing.service.js';
import { KycRoutingMetricService } from './routing/kyc-routing-metric.service.js';
import { KycIntelligentRoutingController } from './routing/kyc-intelligent-routing.controller.js';
import { KycIntelligentGuardrailService } from './routing/kyc-intelligent-guardrail.service.js';
import { KycDistributedCircuitService } from './routing/kyc-distributed-circuit.service.js';

@Module({
  imports: [AuthModule, AuditModule, ReferralModule],
  controllers: [KycController, VerificationController, VerificationAdminController, KycWorkflowController, KycWorkflowAdminController, KycRoutingAdminController, KycCommercialAdminController, KycPlatformCommercialController, KycClientOperationsController, KycPlatformOperationsController, KycClientAnalyticsController, KycPlatformAnalyticsController, KycIntelligentRoutingController],
  providers: [
    KycService,
    VerificationService,
    KycRoutingEngine,
    KycResultArbitrator,
    KycProviderHealthService,
    KycDistributedCircuitService,
    KycProviderScoringService,
    KycIntelligentRoutingService,
    KycRoutingMetricService,
    KycIntelligentGuardrailService,
    KycCommercialService,
    KycStuckDetectionService,
    KycOperationsQueryService,
    KycOperationsCommandService,
    KycOperationalAlertService,
    KycAnalyticsQueryService,
    KycAnalyticsService,
    KycSlaAnalyticsService,
    KycWorkflowEngine,
    KycDecisionEngine,
    KycNameMatchService,
    KycReconciliationEngine,
    ProviderRegistryService,
    SandboxHttpService,
    SandboxVerificationProvider,
    ManualKycProvider,
    {
      provide: KYC_PROVIDER,
      useExisting: ManualKycProvider,
    },
  ],
})
export class KycModule {}
