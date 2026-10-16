-- CreateEnum
CREATE TYPE "ReferralCampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('INVITED', 'REGISTERED', 'KYC_VERIFIED', 'ACTIVATED', 'MILESTONE_IN_PROGRESS', 'QUALIFIED', 'REWARD_PENDING', 'REWARD_APPROVED', 'PAID', 'EXPIRED', 'REJECTED', 'FRAUD_SUSPECTED', 'DISQUALIFIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReferralAttributionSource" AS ENUM ('REFERRAL_CODE', 'QR_CODE', 'DEEP_LINK', 'SHARE_LINK', 'MOBILE_INVITE', 'MANUAL_ADMIN');

-- CreateEnum
CREATE TYPE "ReferralLimitPeriod" AS ENUM ('LIFETIME', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ReferralMilestoneType" AS ENUM ('KYC_VERIFIED', 'RIDER_ACTIVATED', 'VEHICLE_ALLOCATED', 'ACTIVE_DAYS', 'COMPLETED_RIDES', 'COMPLETED_DELIVERIES', 'ATTENDANCE_DAYS', 'TRAINING_COMPLETED', 'FIRST_PAYMENT');

-- CreateEnum
CREATE TYPE "ReferralMilestoneOperator" AS ENUM ('EQ', 'GTE', 'LTE', 'GT', 'LT');

-- CreateEnum
CREATE TYPE "ReferralRewardType" AS ENUM ('CASH', 'WALLET_CREDIT', 'BONUS', 'COUPON', 'SERVICE_CREDIT', 'RENTAL_CREDIT', 'SWAP_CREDIT', 'POINTS', 'OTHER');

-- CreateEnum
CREATE TYPE "ReferralRewardStatus" AS ENUM ('PENDING', 'EARNED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'PAID', 'REJECTED', 'CANCELLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ReferralBeneficiary" AS ENUM ('REFERRER', 'REFEREE');

-- CreateEnum
CREATE TYPE "ReferralFraudType" AS ENUM ('SELF_REFERRAL', 'DUPLICATE_MOBILE', 'DUPLICATE_IDENTITY', 'DUPLICATE_BANK_ACCOUNT', 'SAME_DEVICE', 'DUPLICATE_REFERRAL', 'EXCESSIVE_REFERRAL_VELOCITY', 'CAMPAIGN_LIMIT_EXCEEDED');

-- CreateEnum
CREATE TYPE "ReferralFraudResult" AS ENUM ('CLEAR', 'REVIEW', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ReferralNotificationStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

-- CreateTable
CREATE TABLE "ReferralCampaign" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "displayTitle" TEXT,
    "displayDescription" TEXT,
    "shareMessageTemplate" TEXT,
    "termsAndConditions" TEXT NOT NULL,
    "status" "ReferralCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "registrationValidityDays" INTEGER NOT NULL,
    "qualificationValidityDays" INTEGER NOT NULL,
    "referrerRewardType" "ReferralRewardType",
    "referrerRewardValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "refereeRewardType" "ReferralRewardType",
    "refereeRewardValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "maxReferralsPerRider" INTEGER,
    "referralLimitPeriod" "ReferralLimitPeriod" NOT NULL DEFAULT 'LIFETIME',
    "maxQualifiedReferralsPerRider" INTEGER,
    "maxRewardPerRider" DECIMAL(14,2),
    "campaignBudget" DECIMAL(14,2),
    "budgetReserved" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralCampaignMilestone" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "milestoneType" "ReferralMilestoneType" NOT NULL,
    "operator" "ReferralMilestoneOperator" NOT NULL DEFAULT 'GTE',
    "targetValue" DECIMAL(16,4) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralCampaignMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralIdentity" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "code" VARCHAR(24) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "referrerRiderId" TEXT NOT NULL,
    "refereeUserId" TEXT,
    "refereeRiderId" TEXT,
    "referralCode" VARCHAR(24) NOT NULL,
    "inviteToken" VARCHAR(64),
    "attributionSource" "ReferralAttributionSource" NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'INVITED',
    "ruleSnapshot" JSONB NOT NULL,
    "termsSnapshot" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registeredAt" TIMESTAMP(3),
    "kycVerifiedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "qualifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "qualificationDeadlineAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralMilestoneProgress" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "milestoneType" "ReferralMilestoneType" NOT NULL,
    "operator" "ReferralMilestoneOperator" NOT NULL,
    "targetValue" DECIMAL(16,4) NOT NULL,
    "currentValue" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralMilestoneProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralReward" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "beneficiaryRiderId" TEXT NOT NULL,
    "beneficiary" "ReferralBeneficiary" NOT NULL,
    "rewardType" "ReferralRewardType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "ReferralRewardStatus" NOT NULL DEFAULT 'EARNED',
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralPayout" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "paymentReference" VARCHAR(120) NOT NULL,
    "paymentMethod" VARCHAR(40) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "markedPaidById" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralFraudCheck" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "checkType" "ReferralFraudType" NOT NULL,
    "result" "ReferralFraudResult" NOT NULL,
    "details" JSONB,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralFraudCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralActivityEvent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "sourceEventId" VARCHAR(120) NOT NULL,
    "milestoneType" "ReferralMilestoneType" NOT NULL,
    "quantity" DECIMAL(16,4) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralNotificationOutbox" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "eventKey" VARCHAR(160) NOT NULL,
    "eventType" VARCHAR(60) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "ReferralNotificationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "ReferralNotificationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReferralCampaign_clientId_status_startAt_endAt_idx" ON "ReferralCampaign"("clientId", "status", "startAt", "endAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCampaign_clientId_code_key" ON "ReferralCampaign"("clientId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCampaign_clientId_id_key" ON "ReferralCampaign"("clientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCampaignMilestone_campaignId_milestoneType_key" ON "ReferralCampaignMilestone"("campaignId", "milestoneType");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCampaignMilestone_campaignId_sequence_key" ON "ReferralCampaignMilestone"("campaignId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralIdentity_riderId_key" ON "ReferralIdentity"("riderId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralIdentity_code_key" ON "ReferralIdentity"("code");

-- CreateIndex
CREATE INDEX "ReferralIdentity_clientId_code_idx" ON "ReferralIdentity"("clientId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralIdentity_clientId_riderId_key" ON "ReferralIdentity"("clientId", "riderId");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_inviteToken_key" ON "Referral"("inviteToken");

-- CreateIndex
CREATE INDEX "Referral_clientId_referrerRiderId_createdAt_idx" ON "Referral"("clientId", "referrerRiderId", "createdAt");

-- CreateIndex
CREATE INDEX "Referral_clientId_campaignId_status_idx" ON "Referral"("clientId", "campaignId", "status");

-- CreateIndex
CREATE INDEX "Referral_clientId_expiresAt_status_idx" ON "Referral"("clientId", "expiresAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_clientId_refereeUserId_key" ON "Referral"("clientId", "refereeUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_clientId_refereeRiderId_key" ON "Referral"("clientId", "refereeRiderId");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_clientId_id_key" ON "Referral"("clientId", "id");

-- CreateIndex
CREATE INDEX "ReferralMilestoneProgress_clientId_referralId_idx" ON "ReferralMilestoneProgress"("clientId", "referralId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralMilestoneProgress_referralId_milestoneId_key" ON "ReferralMilestoneProgress"("referralId", "milestoneId");

-- CreateIndex
CREATE INDEX "ReferralReward_clientId_status_createdAt_idx" ON "ReferralReward"("clientId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ReferralReward_clientId_beneficiaryRiderId_status_idx" ON "ReferralReward"("clientId", "beneficiaryRiderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralReward_referralId_beneficiary_key" ON "ReferralReward"("referralId", "beneficiary");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralReward_clientId_id_key" ON "ReferralReward"("clientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralPayout_rewardId_key" ON "ReferralPayout"("rewardId");

-- CreateIndex
CREATE INDEX "ReferralPayout_clientId_paidAt_idx" ON "ReferralPayout"("clientId", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralPayout_clientId_paymentReference_key" ON "ReferralPayout"("clientId", "paymentReference");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralPayout_clientId_rewardId_key" ON "ReferralPayout"("clientId", "rewardId");

-- CreateIndex
CREATE INDEX "ReferralFraudCheck_clientId_result_checkedAt_idx" ON "ReferralFraudCheck"("clientId", "result", "checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralFraudCheck_referralId_checkType_key" ON "ReferralFraudCheck"("referralId", "checkType");

-- CreateIndex
CREATE INDEX "ReferralActivityEvent_clientId_referralId_occurredAt_idx" ON "ReferralActivityEvent"("clientId", "referralId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralActivityEvent_clientId_sourceEventId_key" ON "ReferralActivityEvent"("clientId", "sourceEventId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralNotificationOutbox_eventKey_key" ON "ReferralNotificationOutbox"("eventKey");

-- CreateIndex
CREATE INDEX "ReferralNotificationOutbox_clientId_status_createdAt_idx" ON "ReferralNotificationOutbox"("clientId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_clientId_id_key" ON "User"("clientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Rider_clientId_id_key" ON "Rider"("clientId", "id");

-- AddForeignKey
ALTER TABLE "ReferralCampaign" ADD CONSTRAINT "ReferralCampaign_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCampaignMilestone" ADD CONSTRAINT "ReferralCampaignMilestone_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "ReferralCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralIdentity" ADD CONSTRAINT "ReferralIdentity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralIdentity" ADD CONSTRAINT "ReferralIdentity_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_clientId_campaignId_fkey" FOREIGN KEY ("clientId", "campaignId") REFERENCES "ReferralCampaign"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_clientId_referrerRiderId_fkey" FOREIGN KEY ("clientId", "referrerRiderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_clientId_refereeUserId_fkey" FOREIGN KEY ("clientId", "refereeUserId") REFERENCES "User"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_clientId_refereeRiderId_fkey" FOREIGN KEY ("clientId", "refereeRiderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralMilestoneProgress" ADD CONSTRAINT "ReferralMilestoneProgress_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralMilestoneProgress" ADD CONSTRAINT "ReferralMilestoneProgress_clientId_referralId_fkey" FOREIGN KEY ("clientId", "referralId") REFERENCES "Referral"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralMilestoneProgress" ADD CONSTRAINT "ReferralMilestoneProgress_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "ReferralCampaignMilestone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_clientId_referralId_fkey" FOREIGN KEY ("clientId", "referralId") REFERENCES "Referral"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_clientId_campaignId_fkey" FOREIGN KEY ("clientId", "campaignId") REFERENCES "ReferralCampaign"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_clientId_beneficiaryRiderId_fkey" FOREIGN KEY ("clientId", "beneficiaryRiderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralPayout" ADD CONSTRAINT "ReferralPayout_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralPayout" ADD CONSTRAINT "ReferralPayout_clientId_rewardId_fkey" FOREIGN KEY ("clientId", "rewardId") REFERENCES "ReferralReward"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralFraudCheck" ADD CONSTRAINT "ReferralFraudCheck_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralFraudCheck" ADD CONSTRAINT "ReferralFraudCheck_clientId_referralId_fkey" FOREIGN KEY ("clientId", "referralId") REFERENCES "Referral"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralActivityEvent" ADD CONSTRAINT "ReferralActivityEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralActivityEvent" ADD CONSTRAINT "ReferralActivityEvent_clientId_referralId_fkey" FOREIGN KEY ("clientId", "referralId") REFERENCES "Referral"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralNotificationOutbox" ADD CONSTRAINT "ReferralNotificationOutbox_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralNotificationOutbox" ADD CONSTRAINT "ReferralNotificationOutbox_clientId_referralId_fkey" FOREIGN KEY ("clientId", "referralId") REFERENCES "Referral"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

