import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applicationDefault,
  cert,
  getApp,
  initializeApp,
} from 'firebase-admin/app';
import { FirebasePushProvider } from '../../src/notifications/firebase-push.provider.js';
import { parseFirebaseServiceAccount } from '../../src/config/firebase-credentials.js';

vi.mock('firebase-admin/app', () => ({
  applicationDefault: vi.fn(() => 'adc'),
  cert: vi.fn(() => 'json-credential'),
  getApp: vi.fn(),
  initializeApp: vi.fn(() => ({})),
}));
vi.mock('firebase-admin/messaging', () => ({
  getMessaging: vi.fn(() => ({
    sendEach: vi.fn(async () => ({ responses: [] })),
  })),
}));

const account = {
  type: 'service_account',
  project_id: 'test-project',
  client_email: 'test@test-project.iam.gserviceaccount.com',
  private_key: 'test-only-private-key\nsecond-line',
};

describe('Firebase credential selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getApp).mockImplementation(() => {
      throw new Error('No app');
    });
  });

  it('uses the ECS JSON secret ahead of file-based ADC credentials', async () => {
    const provider = new FirebasePushProvider(
      new ConfigService({
        PUSH_ENABLED: true,
        FIREBASE_PROJECT_ID: account.project_id,
        FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(account),
        GOOGLE_APPLICATION_CREDENTIALS: '/unused/file.json',
      }),
    );
    await provider.send([]);
    expect(cert).toHaveBeenCalledWith({
      projectId: account.project_id,
      clientEmail: account.client_email,
      privateKey: account.private_key,
    });
    expect(applicationDefault).not.toHaveBeenCalled();
    expect(initializeApp).toHaveBeenCalledWith(
      { projectId: account.project_id, credential: 'json-credential' },
      'evseye-push-test-project',
    );
  });

  it('preserves ADC when the JSON secret is absent', async () => {
    await new FirebasePushProvider(
      new ConfigService({
        PUSH_ENABLED: true,
        FIREBASE_PROJECT_ID: account.project_id,
      }),
    ).send([]);
    expect(applicationDefault).toHaveBeenCalledOnce();
    expect(cert).not.toHaveBeenCalled();
  });

  it('rejects a mismatched Firebase project', () => {
    expect(() =>
      parseFirebaseServiceAccount(JSON.stringify(account), 'other-project'),
    ).toThrow('must match FIREBASE_PROJECT_ID');
  });

  it.each([
    'private-key-sensitive-value',
    JSON.stringify({ private_key: 'private-key-sensitive-value' }),
    'null',
  ])('rejects invalid credentials without disclosing their contents', (raw) => {
    let error: unknown;
    try {
      parseFirebaseServiceAccount(raw);
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain('private-key-sensitive-value');
  });
});
