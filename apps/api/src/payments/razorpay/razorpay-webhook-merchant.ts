import { BadRequestException, ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';

export type RazorpayWebhookReferences = {
  orderId?: string | null;
  paymentId?: string | null;
  tokenId?: string | null;
};

/** Payload references are lookup hints only; signature verification must follow. */
export async function resolveWebhookMerchant(
  db: PrismaService,
  refs: RazorpayWebhookReferences,
  routedClientId?: string,
): Promise<string> {
  const owners = new Set<string>();
  if (routedClientId) owners.add(routedClientId);
  const add = (clientId?: string | null) => {
    if (clientId) owners.add(clientId);
  };
  if (refs.orderId) {
    const [deployment, collection, debit, authorization] = await Promise.all([
      db.deploymentPaymentAttempt.findUnique({
        where: { providerOrderId: refs.orderId },
        select: { clientId: true },
      }),
      db.razorpayPenaltyOrder.findUnique({
        where: { providerOrderId: refs.orderId },
        select: { collection: { select: { clientId: true } } },
      }),
      db.paymentTransaction.findFirst({
        where: { provider: 'RAZORPAY', providerOrderId: refs.orderId },
        select: { clientId: true },
      }),
      db.paymentMandate.findFirst({
        where: {
          provider: 'RAZORPAY',
          providerAuthorizationOrderId: refs.orderId,
        },
        select: { clientId: true },
      }),
    ]);
    add(deployment?.clientId);
    add(collection?.collection.clientId);
    add(debit?.clientId);
    add(authorization?.clientId);
  }
  if (refs.paymentId) {
    const [deployment, collection, debit, authorization] = await Promise.all([
      db.deploymentPaymentCapture.findUnique({
        where: { providerPaymentId: refs.paymentId },
        select: { attempt: { select: { clientId: true } } },
      }),
      db.paymentCollectionRequest.findFirst({
        where: { provider: 'RAZORPAY', providerPaymentId: refs.paymentId },
        select: { clientId: true },
      }),
      db.paymentTransaction.findFirst({
        where: {
          provider: 'RAZORPAY',
          OR: [
            { gatewayPaymentId: refs.paymentId },
            { providerReference: refs.paymentId },
          ],
        },
        select: { clientId: true },
      }),
      db.paymentMandate.findFirst({
        where: {
          provider: 'RAZORPAY',
          providerAuthorizationPaymentId: refs.paymentId,
        },
        select: { clientId: true },
      }),
    ]);
    add(deployment?.attempt.clientId);
    add(collection?.clientId);
    add(debit?.clientId);
    add(authorization?.clientId);
  }
  if (refs.tokenId) {
    const mandates = await db.paymentMandate.findMany({
      where: { provider: 'RAZORPAY', providerTokenId: refs.tokenId },
      select: { clientId: true },
    });
    for (const mandate of mandates) add(mandate.clientId);
  }
  if (owners.size > 1)
    throw new ConflictException('Razorpay webhook merchant mismatch.');
  const clientId = [...owners][0];
  if (!clientId)
    throw new BadRequestException({
      code: 'RAZORPAY_WEBHOOK_MERCHANT_REQUIRED',
      message:
        'Use the client-specific webhook URL for events whose payment is not yet registered.',
    });
  return clientId;
}
