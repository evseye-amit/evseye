/** PostgreSQL retry states in both Prisma engine and driver-adapter errors. */
export function retryablePaymentTransaction(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const value = error as { code: unknown; meta?: { code?: unknown; driverAdapterError?: { cause?: { originalCode?: unknown } } } };
  if (value.code === 'P2034') return true;
  return value.code === 'P2010' && ['40001', '40P01'].includes(String(
    value.meta?.code ?? value.meta?.driverAdapterError?.cause?.originalCode,
  ));
}
