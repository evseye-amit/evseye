import { isPreLoginErrorCode, type PreLoginErrorCode } from './prelogin-error-codes.generated';

export type PreLoginFailure = { code?: string; message?: string };

export function normalizePreLoginFailure(value: unknown): { code?: PreLoginErrorCode; message: string } {
  const failure = (value && typeof value === 'object' ? value : {}) as PreLoginFailure;
  const code = isPreLoginErrorCode(failure.code) ? failure.code : undefined;
  return { code, message: failure.message || (code === 'WORKSPACE_NOT_FOUND' ? 'Company code was not found.' : 'Workspace unavailable.') };
}

export function isRetryablePreLoginFailure(code?: PreLoginErrorCode) {
  return code === 'WORKSPACE_UNAVAILABLE';
}
