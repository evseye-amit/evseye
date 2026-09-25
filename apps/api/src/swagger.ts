import type { OpenAPIObject, OperationObject, ResponseObject } from '@nestjs/swagger';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/**
 * Swagger UI has a flat tag list, so the middle dot keeps related endpoints
 * together while remaining easy to scan (for example, Platform Catalog · OEM).
 */
export const SWAGGER_TAGS = [
  ['Health', 'Service liveness and readiness checks.'],
  ['Auth', 'OTP authentication, sessions, and the current user.'],
  ['Platform Catalog · Dashboard', 'Platform catalog overview metrics.'],
  ['Platform Catalog · OEM', 'OEM master data and OEM logo uploads.'],
  ['Platform Catalog · Vehicle Category', 'Vehicle category master data.'],
  ['Platform Catalog · Vehicle Type', 'Vehicle type master data.'],
  ['Platform Catalog · Feature', 'Feature catalog and add-on eligibility.'],
  ['Platform Catalog · Feature Step', 'Feature workflow step definitions.'],
  ['Platform Catalog · Feature Pricing', 'Feature prices and effective dates.'],
  ['Platform Catalog · Training Content', 'Training-content catalog.'],
  ['Package Management · Package', 'Platform package definitions.'],
  ['Package Management · Package Feature', 'Features included in packages.'],
  ['Package Management · Tiered Pricing', 'Package vehicle-count tiers.'],
  ['Client Management · Onboarding', 'Client onboarding, approval, and profile administration.'],
  ['Client Management · Domains & Branding', 'Client domains and public branding.'],
  ['Client Commercials · Subscription', 'Client subscriptions and package quotations.'],
  ['Client Commercials · Features & Pricing', 'Client-specific features, pricing, entitlements, and usage.'],
  ['Client Commercials · Adjustments', 'Client commercial adjustments.'],
  ['Client Operations · Dashboard', 'Client operational dashboard.'],
  ['Client Operations · Users', 'Client users, fleet managers, and team leaders.'],
  ['Client Operations · Fleet', 'Fleet, components, documents, and lifecycle operations.'],
  ['Client Operations · Hubs & Zones', 'Client hubs and geographic operations.'],
  ['Client Operations · Rider', 'Riders, KYC, and rider documents.'],
  ['Client Operations · Rider Billing', 'Rider charges, credits, invoices, and ledger.'],
  ['Client Operations · Referrals', 'Referral campaigns, review, rewards, and analytics.'],
  ['Client Operations · Allocation', 'Fleet allocations and mobile deployments.'],
  ['Client Operations · IoT', 'Client IoT device administration.'],
  ['Client Operations · Media', 'Operational media upload and retrieval.'],
  ['Client Operations · Inspections', 'Fleet and rider inspection operations.'],
  ['Client Operations · Audit Log', 'Client operational audit trails.'],
  ['Rider App', 'Rider-facing application endpoints.'],
  ['Device Ingestion', 'Device-authenticated IoT ingestion endpoints.'],
] as const;

function tagForPath(path: string): string {
  if (path === '/health' || path === '/health/ready') return 'Health';
  if (path.startsWith('/api/v1/auth/')) return 'Auth';
  if (path === '/api/v1/platform/dashboard') return 'Platform Catalog · Dashboard';
  if (path.startsWith('/api/v1/platform/oems')) return 'Platform Catalog · OEM';
  if (path.startsWith('/api/v1/platform/vehicle-categories')) return 'Platform Catalog · Vehicle Category';
  if (path.startsWith('/api/v1/platform/vehicle-types')) return 'Platform Catalog · Vehicle Type';
  if (path.startsWith('/api/v1/platform/feature-steps')) return 'Platform Catalog · Feature Step';
  if (path.startsWith('/api/v1/platform/feature-pricing') || path.includes('/current-price')) return 'Platform Catalog · Feature Pricing';
  if (path.startsWith('/api/v1/platform/features')) return 'Platform Catalog · Feature';
  if (path.startsWith('/api/v1/platform/training-content')) return 'Platform Catalog · Training Content';
  if (path.startsWith('/api/v1/platform/package-features')) return 'Package Management · Package Feature';
  if (path.startsWith('/api/v1/platform/packages')) return 'Package Management · Package';
  if (path.includes('/vehicle-tiers')) return 'Package Management · Tiered Pricing';
  if (path.startsWith('/api/v1/platform/commercial/subscriptions')) return 'Client Commercials · Subscription';
  if (path.startsWith('/api/v1/platform/commercial/adjustments')) return 'Client Commercials · Adjustments';
  if (path.startsWith('/api/v1/platform/commercial/clients/')) return 'Client Commercials · Features & Pricing';
  if (path.startsWith('/api/v1/platform/commercial/')) return 'Client Commercials · Features & Pricing';
  if (path.includes('/features') || path.includes('/entitlements')) return 'Client Commercials · Features & Pricing';
  if (path.includes('/domains') || path.startsWith('/api/v1/client-branding') || path.startsWith('/api/v1/platform/client-branding')) return 'Client Management · Domains & Branding';
  if (path.startsWith('/api/v1/platform/clients') || path.startsWith('/api/v1/platform/client')) return 'Client Management · Onboarding';
  if (path.startsWith('/api/v1/public/') || path.startsWith('/api/v1/client/identity')) return 'Client Management · Domains & Branding';
  if (path.startsWith('/api/v1/client/users')) return 'Client Operations · Users';
  if (path.startsWith('/api/v1/hubs') || path.startsWith('/api/v1/zones')) return 'Client Operations · Hubs & Zones';
  if (path.startsWith('/api/v1/fleets')) return 'Client Operations · Fleet';
  if (path.startsWith('/api/v1/riders') || path.startsWith('/api/v1/rider-documents')) return 'Client Operations · Rider';
  if (path.startsWith('/api/v1/client/riders/') && path.includes('/billing')) return 'Client Operations · Rider Billing';
  if (path.startsWith('/api/v1/client/referrals') || path.includes('/referral-events')) return 'Client Operations · Referrals';
  if (path.startsWith('/api/v1/allocations') || path.startsWith('/api/v1/mobile-deployments')) return 'Client Operations · Allocation';
  if (path.startsWith('/api/v1/inspections')) return 'Client Operations · Inspections';
  if (path.startsWith('/api/v1/media')) return 'Client Operations · Media';
  if (path.startsWith('/api/v1/audit-logs')) return 'Client Operations · Audit Log';
  if (path.startsWith('/api/v1/dashboard')) return 'Client Operations · Dashboard';
  if (path.startsWith('/api/v1/rider-app')) return 'Rider App';
  if (path === '/api/v1/iot/ingest') return 'Device Ingestion';
  if (path.startsWith('/api/v1/iot')) return 'Client Operations · IoT';
  return 'Client Management · Onboarding';
}
const PUBLIC_PATHS = new Set([
  '/health',
  '/health/ready',
  '/api/v1/public/client-context',
  '/api/v1/auth/otp/request',
  '/api/v1/auth/otp/verify',
  '/api/v1/auth/refresh',
  '/api/v1/auth/logout',
  '/api/v1/rider-app/enroll',
  '/api/v1/public/referrals/resolve',
]);

/** Add the envelopes shared by controllers that return anonymous objects. */
export function completeSwaggerDocument(document: OpenAPIObject): OpenAPIObject {
  document.components ??= {};
  document.components.schemas ??= {};
  document.components.schemas.ApiDataEnvelope = {
    type: 'object',
    required: ['data'],
    properties: {
      data: {
        description: 'Endpoint-specific response. Use Try it out to inspect the live payload.',
      },
    },
  };
  document.components.schemas.ApiErrorEnvelope = {
    type: 'object',
    required: ['error', 'requestId'],
    properties: {
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string', example: 'HTTP_ERROR' },
          message: { type: 'string', example: 'Validation failed.' },
        },
      },
      requestId: { type: 'string', example: 'req-123' },
    },
  };

  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const method of METHODS) {
      const operation = pathItem?.[method] as OperationObject | undefined;
      if (!operation) continue;
      operation.tags = [tagForPath(path)];
      if (path === '/api/v1/iot/ingest') {
        operation.security = [{ deviceSecret: [] }];
      } else if (!PUBLIC_PATHS.has(path)) {
        operation.security ??= [{ bearer: [] }];
      }
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        if (!response || !/^2\d\d$/.test(status) || status === '204' || '$ref' in response) continue;
        const success = response as ResponseObject;
        if (success.content) continue;
        if (path === '/health' || path === '/health/ready') continue;
        success.description ||= 'Successful response. Execute the request to inspect its data.';
        success.content = {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiDataEnvelope' },
          },
        };
      }
      operation.responses ??= {};
      operation.responses.default ??= {
        description: 'Error response',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiErrorEnvelope' },
          },
        },
      };
    }
  }
  return document;
}
