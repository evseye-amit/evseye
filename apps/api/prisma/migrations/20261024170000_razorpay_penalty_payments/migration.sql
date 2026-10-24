-- CreateTable
CREATE TABLE "RazorpayPenaltyOrder" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "keyId" VARCHAR(100) NOT NULL,
    "providerOrderId" VARCHAR(80),
    "amountPaise" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'CREATING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RazorpayPenaltyOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RazorpayPenaltyCapture" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "providerPaymentId" VARCHAR(120) NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "reason" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RazorpayPenaltyCapture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RazorpayPenaltyOrder_collectionId_key" ON "RazorpayPenaltyOrder"("collectionId");

-- CreateIndex
CREATE UNIQUE INDEX "RazorpayPenaltyOrder_providerOrderId_key" ON "RazorpayPenaltyOrder"("providerOrderId");

-- CreateIndex
CREATE INDEX "RazorpayPenaltyOrder_status_checkedAt_idx" ON "RazorpayPenaltyOrder"("status", "checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RazorpayPenaltyCapture_providerPaymentId_key" ON "RazorpayPenaltyCapture"("providerPaymentId");

-- CreateIndex
CREATE INDEX "RazorpayPenaltyCapture_status_createdAt_idx" ON "RazorpayPenaltyCapture"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "RazorpayPenaltyOrder" ADD CONSTRAINT "RazorpayPenaltyOrder_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "PaymentCollectionRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RazorpayPenaltyCapture" ADD CONSTRAINT "RazorpayPenaltyCapture_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "RazorpayPenaltyOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

