import type {
  PaymentProvider,
  CreateMandateInput,
} from './payment-provider.interface.js';
/** Mandates/debits are selected independently of one-time checkout. */
export type AutoPayProvider = Pick<
  PaymentProvider,
  | 'assertChargeEligible'
  | 'createMandate'
  | 'fetchMandate'
  | 'cancelMandate'
  | 'pauseMandate'
  | 'resumeMandate'
  | 'createPayment'
  | 'fetchPayment'
> & {
  assertMandateEligible?(clientId: string, input: CreateMandateInput): void;
};
