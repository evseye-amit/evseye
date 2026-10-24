// Enable Yogmaya exchanges without introducing a fee, waiting period or new submission rules.
export const yogmayaExchangePolicy = {
  exchangeAllowed: true,
  minimumDaysOnVehicle: 0,
  prorationMode: 'NONE',
  prorationPolicy: 'NO_PRORATION',
  depositExcessPolicy: 'REFUND_REQUEST',
  exchangeFeeAmount: '0.00',
  feeWaiverReasonCodes: [],
  offerValidityMinutes: 60,
  reservationMinutes: 120,
};

export async function seedYogmayaExchangePolicy(prisma) {
  const client = await prisma.client.findUnique({
    where: { slug: 'yogmaya' },
    select: { id: true },
  });
  if (!client) throw new Error('Exchange policy seed requires the yogmaya client.');
  return prisma.clientExchangePolicy.upsert({
    where: { clientId: client.id },
    create: { clientId: client.id, ...yogmayaExchangePolicy },
    // Preserve any existing commercial settings; only enabling exchanges is intentional on rerun.
    update: { exchangeAllowed: true },
  });
}
