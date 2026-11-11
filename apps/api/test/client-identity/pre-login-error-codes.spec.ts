import { describe, expect, it } from 'vitest';
import { PRE_LOGIN_ERROR_CODES } from '../../src/client-identity/pre-login-error-codes.js';

describe('pre-login error contract', () => {
  it('contains every public workspace/app error code exactly once', () => {
    expect(new Set(PRE_LOGIN_ERROR_CODES).size).toBe(PRE_LOGIN_ERROR_CODES.length);
    expect(PRE_LOGIN_ERROR_CODES).toEqual([
      'WORKSPACE_NOT_FOUND',
      'WORKSPACE_UNAVAILABLE',
      'WORKSPACE_HOST_MISMATCH',
      'WORKSPACE_INACTIVE',
      'WORKSPACE_PENDING_APPROVAL',
      'WORKSPACE_SUSPENDED',
      'UNSUPPORTED_APP_ROLE',
    ]);
  });
});
