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
