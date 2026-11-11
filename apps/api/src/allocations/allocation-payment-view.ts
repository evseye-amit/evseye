/** UPI app results are claims; only existing staff verification settles payment. */
export function allocationPaymentView<T extends { status: string }>(
  payment: T,
  workflowStatus: string,
) {
  const nextAction =
    payment.status === 'PAID'
      ? 'PAYMENT_COMPLETE'
      : payment.status === 'SUBMITTED'
        ? 'AWAITING_VERIFICATION'
        : workflowStatus !== 'PAYMENT_PENDING'
          ? 'CONTACT_SUPPORT'
          : payment.status === 'REJECTED'
            ? 'CORRECT_PAYMENT_DETAILS'
            : payment.status === 'PENDING'
              ? 'SUBMIT_PAYMENT_DETAILS'
              : 'CONTACT_SUPPORT';
  return {
    ...payment,
    source: 'DEPLOYMENT' as const,
    nextAction,
    canSubmit:
      workflowStatus === 'PAYMENT_PENDING' &&
      ['PENDING', 'REJECTED'].includes(payment.status),
    receiptOptional: true,
  };
}
