import type { ServiceAccount } from 'firebase-admin/app';
import { z } from 'zod';

const serviceAccountSchema = z.object({
  type: z.literal('service_account'),
  project_id: z.string().min(1),
  client_email: z.string().email(),
  private_key: z.string().min(1),
});

export function parseFirebaseServiceAccount(
  raw: string,
  projectId?: string,
): ServiceAccount {
  // Never include parser errors or input values: they can contain the private key.
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON must be valid service-account JSON.',
    );
  }
  const result = serviceAccountSchema.safeParse(input);
  if (!result.success)
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON requires service_account type, project_id, client_email and private_key.',
    );
  if (projectId && result.data.project_id !== projectId)
    throw new Error(
      'Firebase service-account project must match FIREBASE_PROJECT_ID.',
    );
  return {
    projectId: result.data.project_id,
    clientEmail: result.data.client_email,
    privateKey: result.data.private_key,
  };
}
