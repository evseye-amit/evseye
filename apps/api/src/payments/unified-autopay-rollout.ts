import type { ConfigService } from '@nestjs/config';
/** Explicit tenant allowlist: enabling the platform flag never migrates every client. */
export function unifiedAutoPayEnabled(config: ConfigService, clientId: string): boolean {
  return config.get('UNIFIED_AUTOPAY_ENABLED') === 'true' && String(config.get('UNIFIED_AUTOPAY_CLIENT_IDS') ?? '').split(',').map(value => value.trim()).includes(clientId);
}
