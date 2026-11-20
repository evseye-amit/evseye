export type DeploymentCheckoutOptions = {
  setupAutoPay?: boolean;
  email?: string;
  autoPayConsent?: { accepted: true; version: 'deployment-autopay-v1'; maxAmount: string; validityDays: number };
  requestKey?: string;
};
export interface DeploymentPaymentOrder {
  provider: string;
  orderId: string;
}

export interface DeploymentPaymentProvider {
  readonly name: string;
  createOrder(
    clientId: string,
    userId: string,
    allocationId: string,
    options?: DeploymentCheckoutOptions,
  ): Promise<DeploymentPaymentOrder>;
  verify(
    clientId: string,
    userId: string,
    allocationId: string,
    body: unknown,
  ): Promise<{ nextAction?: string }>;
  reconcile(clientId: string, userId: string, allocationId: string, attemptId: string): Promise<unknown>;
}

export type DeploymentPaymentOperations = Pick<
  DeploymentPaymentProvider,
  'createOrder' | 'verify' | 'reconcile'
>;

export const DEPLOYMENT_PAYMENT_PROVIDER = Symbol('DEPLOYMENT_PAYMENT_PROVIDER');
