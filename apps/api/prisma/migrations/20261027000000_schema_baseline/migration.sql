-- Baseline generated from apps/api/prisma/schema.prisma.
-- Existing databases must mark this migration applied; do not replay on populated databases.
-- Database extensions required by the Prisma schema (PostGIS geography fields)
CREATE SCHEMA IF NOT EXISTS tiger;
CREATE SCHEMA IF NOT EXISTS topology;

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;

CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA public;

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;

CREATE EXTENSION IF NOT EXISTS postgis_tiger_geocoder WITH SCHEMA tiger;

CREATE EXTENSION IF NOT EXISTS postgis_topology WITH SCHEMA topology;

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADVISOR', 'QC_MANAGER', 'SUPER_ADMIN', 'CLIENT_ADMIN', 'FLEET_MANAGER', 'TEAM_LEAD', 'KYC_OPERATOR', 'RIDER');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('LOGIN', 'HANDOVER_RIDER', 'HANDOVER_OPERATOR');

-- CreateEnum
CREATE TYPE "OtpStatus" AS ENUM ('PENDING', 'VERIFIED', 'EXPIRED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RiderStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'INACTIVE', 'BLOCKED', 'EXITED');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY');

-- CreateEnum
CREATE TYPE "HubType" AS ENUM ('OPERATIONS', 'PARKING', 'CHARGING', 'BATTERY_SWAP', 'MAINTENANCE', 'WAREHOUSE', 'DELIVERY', 'MIXED');

-- CreateEnum
CREATE TYPE "HubStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'TEMPORARILY_CLOSED', 'UNDER_MAINTENANCE', 'FULL');

-- CreateEnum
CREATE TYPE "ClientOnboardingStep" AS ENUM ('HUBS', 'FLEET_MANAGERS', 'TEAM_LEADERS', 'FLEETS', 'RIDERS', 'REVIEW');

-- CreateEnum
CREATE TYPE "ClientOnboardingStepStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ImportEntityType" AS ENUM ('HUB', 'FLEET_MANAGER', 'TEAM_LEADER', 'FLEET', 'BATTERY', 'CONTROLLER', 'IOT_DEVICE', 'FLEET_COMPONENT_MAPPING', 'RIDER');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PASS', 'PARTIAL_PASS', 'FAIL');

-- CreateEnum
CREATE TYPE "PhotoWorkflowType" AS ENUM ('FLEET_INSPECTION', 'FLEET_PREPARATION', 'FLEET_ALLOTMENT', 'FLEET_SUBMISSION', 'RIDER_ONBOARDING', 'SUPPORT', 'PAYMENT');

-- CreateEnum
CREATE TYPE "PhotoSubjectType" AS ENUM ('FLEET', 'BATTERY', 'CONTROLLER', 'IOT_DEVICE', 'MOTOR', 'TYRE', 'DOCK', 'CHASSIS', 'DASHBOARD', 'PROFILE', 'PAN', 'AADHAR', 'DRIVING_LICENSE', 'BANK', 'DECLARATION', 'ONBOARDING_FEES', 'SUPPORT_TICKET', 'COLLECTION', 'AUTOPAY', 'OTHER');

-- CreateEnum
CREATE TYPE "PhotoType" AS ENUM ('FRONT', 'BACK', 'LEFT', 'RIGHT', 'BODY', 'LABEL', 'DOCUMENT', 'FACE', 'RECEIPT', 'OTHER');

-- CreateEnum
CREATE TYPE "RiderDocumentReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "PhotoStatus" AS ENUM ('PENDING_UPLOAD', 'COMPLETE', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "KycType" AS ENUM ('AADHAAR', 'PAN', 'BANK_ACCOUNT');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'VERIFIED', 'FAILED', 'RETRY_REQUIRED');

-- CreateEnum
CREATE TYPE "FleetStatus" AS ENUM ('PENDING_ACTIVATION', 'IN_TRANSIT', 'AVAILABLE', 'RESERVED', 'ALLOCATION_IN_PROGRESS', 'ALLOCATED', 'IN_USE', 'DEALLOCATION_IN_PROGRESS', 'INSPECTION_PENDING', 'MAINTENANCE', 'BROKEN', 'AWAITING_PARTS', 'OUT_OF_SERVICE');

-- CreateEnum
CREATE TYPE "FleetOnboardingStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VehicleSpeedType" AS ENUM ('SLOW_SPEED', 'HIGH_SPEED');

-- CreateEnum
CREATE TYPE "FleetOwnershipType" AS ENUM ('CLIENT_OWNED', 'LEASED', 'ATTACHED', 'OEM_OWNED', 'THIRD_PARTY');

-- CreateEnum
CREATE TYPE "BatteryType" AS ENUM ('FIXED_SINGLE', 'FIXED_DOUBLE', 'SWAP_IF', 'SWAP_BS', 'SWAP_MOVING', 'SWAP_OTHER');

-- CreateEnum
CREATE TYPE "BatteryStatus" AS ENUM ('AVAILABLE', 'INSTALLED', 'CHARGING', 'IN_SWAP', 'UNDER_MAINTENANCE', 'DAMAGED', 'RETIRED');

-- CreateEnum
CREATE TYPE "BatteryChemistry" AS ENUM ('LFP', 'NMC', 'LTO', 'LEAD_ACID', 'OTHER');

-- CreateEnum
CREATE TYPE "BatterySlot" AS ENUM ('PRIMARY', 'SECONDARY', 'AUXILIARY');

-- CreateEnum
CREATE TYPE "ControllerStatus" AS ENUM ('AVAILABLE', 'INSTALLED', 'UNDER_MAINTENANCE', 'DAMAGED', 'RETIRED');

-- CreateEnum
CREATE TYPE "InsuranceType" AS ENUM ('THIRD_PARTY', 'COMPREHENSIVE', 'OWN_DAMAGE');

-- CreateEnum
CREATE TYPE "FleetDocumentType" AS ENUM ('RC', 'INSURANCE', 'FITNESS_CERTIFICATE', 'PERMIT', 'PUC', 'INVOICE', 'WARRANTY', 'OTHER');

-- CreateEnum
CREATE TYPE "IoTDeviceStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'OFFLINE', 'DAMAGED', 'UNASSIGNED');

-- CreateEnum
CREATE TYPE "FleetTransferStatus" AS ENUM ('INITIATED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('INITIATED', 'INSPECTION_PENDING', 'OTP_PENDING', 'ACTIVE', 'DEALLOCATION_INITIATED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InspectionType" AS ENUM ('PRE_ALLOCATION', 'POST_DEALLOCATION');

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MobileDeploymentStatus" AS ENUM ('RIDER_WAITING', 'FLEET_REQUESTED', 'PAYMENT_PENDING', 'PAYMENT_PAID', 'PDI_PENDING_RIDER', 'TRAINING_PENDING', 'DEVICE_PAIRING_PENDING', 'DEPLOYED');

-- CreateEnum
CREATE TYPE "DeploymentPaymentStatus" AS ENUM ('PENDING', 'REJECTED', 'SUBMITTED', 'PAID', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IoTEventType" AS ENUM ('LOCATION', 'HEARTBEAT', 'START', 'STOP');

-- CreateEnum
CREATE TYPE "MasterRecordStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "EnergyType" AS ENUM ('ELECTRIC', 'HYBRID', 'PETROL', 'DIESEL', 'CNG', 'HYDROGEN', 'OTHER', 'LPG');

-- CreateEnum
CREATE TYPE "VehicleUsageType" AS ENUM ('PRIVATE', 'PASSENGER', 'GOODS', 'DELIVERY', 'SHARED_MOBILITY', 'PUBLIC_TRANSPORT', 'STAFF_TRANSPORT', 'SCHOOL_TRANSPORT', 'EMERGENCY', 'AGRICULTURAL', 'CONSTRUCTION', 'INDUSTRIAL', 'RENTAL', 'GOVERNMENT', 'SPECIAL_PURPOSE');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('ONCE', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "PricingTierMode" AS ENUM ('VOLUME', 'GRADUATED');

-- CreateEnum
CREATE TYPE "AllowanceResetPeriod" AS ENUM ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "ClientSubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PricingAdjustmentScope" AS ENUM ('SETUP_FEE', 'PACKAGE', 'FEATURE', 'FEATURE_ADDON', 'TOTAL_INVOICE');

-- CreateEnum
CREATE TYPE "PricingAdjustmentType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT', 'OVERRIDE_PRICE');

-- CreateEnum
CREATE TYPE "FeatureAddOnPurchaseStatus" AS ENUM ('PENDING', 'ACTIVE', 'CONSUMED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FeatureCreditSourceType" AS ENUM ('PACKAGE_ALLOWANCE', 'FEATURE_ADDON', 'MANUAL_ADJUSTMENT', 'PROMOTIONAL_CREDIT');

-- CreateEnum
CREATE TYPE "FeatureUsageTransactionType" AS ENUM ('CREDIT', 'DEBIT', 'EXPIRE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "KycUsageRecognition" AS ENUM ('ON_REQUEST', 'ON_COMPLETION', 'ON_SUCCESS');

-- CreateEnum
CREATE TYPE "KycOveragePolicy" AS ENUM ('BLOCK', 'ALLOW_AND_CHARGE', 'ALLOW_WITH_WARNING');

-- CreateEnum
CREATE TYPE "FeatureConsumptionSource" AS ENUM ('INCLUDED', 'ADD_ON', 'UNLIMITED', 'OVERAGE');

-- CreateEnum
CREATE TYPE "ClientFeatureSource" AS ENUM ('PACKAGE', 'ADD_ON', 'CUSTOM', 'PROMOTIONAL');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('DRAFT', 'CREATED', 'PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ClientContactRole" AS ENUM ('PRIMARY', 'ACCOUNT_ADMIN', 'BILLING');

-- CreateEnum
CREATE TYPE "ClientAddressType" AS ENUM ('REGISTERED', 'BILLING');

-- CreateEnum
CREATE TYPE "ClientDocumentType" AS ENUM ('PAN_CARD', 'GST_CERTIFICATE', 'INCORPORATION_CERTIFICATE', 'FLEET_AGREEMENT', 'BUSINESS_AGREEMENT');

-- CreateEnum
CREATE TYPE "DocumentVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FleetBusinessModel" AS ENUM ('OWNED', 'LEASED', 'ATTACHED', 'MIXED');

-- CreateEnum
CREATE TYPE "VehicleOwnership" AS ENUM ('OWNED', 'LEASED', 'DRIVER_OWNED', 'MIXED');

-- CreateEnum
CREATE TYPE "ClientIndustry" AS ENUM ('LOGISTICS', 'LAST_MILE', 'DELIVERY', 'MOBILITY', 'RENTAL', 'OTHER');

-- CreateEnum
CREATE TYPE "FeatureCategory" AS ENUM ('PRE_LOGIN', 'LOGIN', 'RIDER_ONBOARDING', 'RIDER_VERIFICATION', 'RIDER_TRAINING', 'RIDER_MANAGEMENT', 'ATTENDANCE', 'FACE_RECOGNITION', 'FLEET_MANAGEMENT', 'VEHICLE_MANAGEMENT', 'IOT_TELEMATICS', 'TRACKING_GEOFENCING', 'BATTERY_MANAGEMENT', 'SERVICE_MAINTENANCE', 'MECHANIC_MANAGEMENT', 'SAFETY_COMPLIANCE', 'ANALYTICS', 'REPORTING', 'NOTIFICATION', 'INTEGRATION', 'API_ACCESS', 'USER_ACCESS', 'DOCUMENT_MANAGEMENT', 'USER_VERIFICATION', 'COUPON', 'TRAINING', 'SUPPORT', 'AI_AUTOMATION', 'OTHER');

-- CreateEnum
CREATE TYPE "FeatureType" AS ENUM ('BOOLEAN', 'QUANTITY', 'USAGE_BASED', 'CONFIGURATION');

-- CreateEnum
CREATE TYPE "FeatureBillingUnit" AS ENUM ('SMS', 'EMAIL', 'UPLOAD', 'WHATSAPP_MESSAGE', 'VERIFICATION', 'RIDER', 'VEHICLE', 'FLEET', 'USER', 'API_CALL', 'FACE_SCAN', 'TRAINING', 'DEVICE', 'GB', 'MONTH', 'AI_CREDIT', 'LIFE_TIME');

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

-- CreateEnum
CREATE TYPE "RiderChargeStatus" AS ENUM ('OPEN', 'INVOICED', 'VOIDED');

-- CreateEnum
CREATE TYPE "RiderCreditStatus" AS ENUM ('AVAILABLE', 'PARTIALLY_APPLIED', 'APPLIED', 'VOIDED');

-- CreateEnum
CREATE TYPE "RiderInvoiceStatus" AS ENUM ('DRAFT', 'FINALIZED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID');

-- CreateEnum
CREATE TYPE "RiderInvoiceLineKind" AS ENUM ('CHARGE', 'CREDIT');

-- CreateEnum
CREATE TYPE "RiderLedgerEntryType" AS ENUM ('CHARGE', 'CREDIT', 'PAYMENT', 'REFUND', 'ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "RiderLedgerCategory" AS ENUM ('CHARGE_BALANCE', 'REFUNDABLE_DEPOSIT_LIABILITY');

-- CreateEnum
CREATE TYPE "RiderDepositStatus" AS ENUM ('REQUIRED', 'PARTIALLY_COLLECTED', 'HELD', 'SETTLEMENT_PENDING', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FORFEITED', 'CLOSED');

-- CreateEnum
CREATE TYPE "RiderDepositTransactionType" AS ENUM ('COLLECTION', 'WAIVER', 'DEDUCTION', 'REFUND', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT_CREDIT', 'ADJUSTMENT_DEBIT', 'REVERSAL', 'FORFEITURE');

-- CreateEnum
CREATE TYPE "RiderDepositRefundStatus" AS ENUM ('REQUESTED', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "VehicleExchangeStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REPLACEMENT_SELECTED', 'OFFER_PRESENTED', 'ACCEPTED', 'RETURN_PENDING', 'DEPOSIT_PENDING', 'HANDOVER_PENDING', 'COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "VehicleExchangeOfferStatus" AS ENUM ('PRESENTED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ExchangeProrationMode" AS ENUM ('NONE', 'DAILY', 'HOURLY', 'CALENDAR_DAY', 'BILLING_PERIOD_REMAINDER');

-- CreateEnum
CREATE TYPE "ExchangeProrationPolicy" AS ENUM ('NO_PRORATION', 'PRORATE_OLD_ONLY', 'PRORATE_NEW_ONLY', 'PRORATE_BOTH', 'START_NEW_NEXT_BILLING_CYCLE');

-- CreateEnum
CREATE TYPE "ExchangeDepositExcessPolicy" AS ENUM ('REFUND_REQUEST', 'RETAIN_HELD');

-- CreateEnum
CREATE TYPE "DepositActivationPolicyType" AS ENUM ('FULL_REQUIRED', 'MINIMUM_PERCENTAGE', 'MINIMUM_AMOUNT', 'WAIVER_ALLOWED', 'NOT_REQUIRED_BEFORE_ACTIVATION');

-- CreateEnum
CREATE TYPE "PaymentMandateStatus" AS ENUM ('CREATING', 'CREATED', 'AUTHORIZATION_PENDING', 'ACTIVE', 'PAUSED', 'CANCELLED', 'FAILED', 'EXPIRED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PaymentProviderEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentTransactionStatus" AS ENUM ('CREATING', 'PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "FleetOperatingMode" AS ENUM ('SIMPLE', 'ONBOARDING_EVIDENCE', 'PREPARATION_QC', 'STAGED_PREPARATION_QC');

-- CreateEnum
CREATE TYPE "WorkPartnerCategory" AS ENUM ('FOOD_DELIVERY', 'QUICK_COMMERCE', 'ECOMMERCE', 'PARCEL_LOGISTICS', 'ON_DEMAND_LOGISTICS', 'PHARMACY_HEALTHCARE', 'SPECIALTY_DELIVERY', 'OTHER');

-- CreateEnum
CREATE TYPE "KycVerificationType" AS ENUM ('PAN_VERIFICATION', 'AADHAAR_OTP', 'AADHAAR_OKYC', 'BANK_ACCOUNT_VERIFICATION', 'IFSC_VERIFICATION', 'PAN_AADHAAR_LINK', 'DIGILOCKER', 'NAME_MATCH', 'FACE_MATCH', 'LIVENESS');

-- CreateEnum
CREATE TYPE "KycVerificationStatus" AS ENUM ('CREATED', 'QUEUED', 'PROCESSING', 'ACTION_REQUIRED', 'OTP_REQUIRED', 'VERIFIED', 'PARTIALLY_VERIFIED', 'FAILED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "KycProviderCode" AS ENUM ('SANDBOX', 'CASHFREE', 'SUREPASS', 'HYPERVERGE');

-- CreateEnum
CREATE TYPE "KycProviderEnvironment" AS ENUM ('TEST', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "KycFailureType" AS ENUM ('BUSINESS_FAILURE', 'TECHNICAL_FAILURE');

-- CreateEnum
CREATE TYPE "KycRoutingStrategy" AS ENUM ('PRIORITY', 'FALLBACK', 'WEIGHTED', 'PARALLEL', 'HEDGED', 'LOWEST_COST', 'LOWEST_LATENCY', 'SMART');

-- CreateEnum
CREATE TYPE "KycArbitrationMode" AS ENUM ('FIRST_VERIFIED', 'FIRST_TERMINAL', 'MAJORITY', 'ALL_MUST_AGREE', 'MANUAL_REVIEW_ON_CONFLICT');

-- CreateEnum
CREATE TYPE "KycAttemptReason" AS ENUM ('PRIMARY', 'RETRY', 'FALLBACK', 'WEIGHTED_SELECTION', 'PARALLEL', 'HEDGE', 'HEALTH_FAILOVER');

-- CreateEnum
CREATE TYPE "KycWorkflowStatus" AS ENUM ('CREATED', 'IN_PROGRESS', 'ACTION_REQUIRED', 'WAITING', 'RECONCILING', 'DECISION_PENDING', 'VERIFIED', 'MANUAL_REVIEW', 'REJECTED', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "KycStepStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'ACTION_REQUIRED', 'VERIFIED', 'FAILED', 'SKIPPED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "KycStepFailureBehavior" AS ENUM ('STOP_WORKFLOW', 'CONTINUE', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "KycStepActionMode" AS ENUM ('AUTOMATIC', 'USER_ACTION', 'MANUAL_ACTION');

-- CreateEnum
CREATE TYPE "KycDecisionOutcome" AS ENUM ('PENDING', 'VERIFIED', 'MANUAL_REVIEW', 'REJECTED');

-- CreateEnum
CREATE TYPE "ClientDomainType" AS ENUM ('EVSEYE_SUBDOMAIN', 'CUSTOM_DOMAIN');

-- CreateEnum
CREATE TYPE "RiderRateCardStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RentalPeriodType" AS ENUM ('DAILY', 'WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'QUARTERLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "RiderChargeNature" AS ENUM ('ONE_TIME', 'RECURRING', 'USAGE_BASED', 'REFUNDABLE_DEPOSIT', 'PENALTY', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "RiderAdjustmentCalculationType" AS ENUM ('FIXED_AMOUNT', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "RiderAdjustmentType" AS ENUM ('LOCATION', 'HUB', 'VEHICLE', 'VEHICLE_AGE', 'VEHICLE_GRADE', 'BATTERY_PLAN', 'RIDER_TIER', 'CLIENT_SUBSIDY', 'PROMOTION', 'MANUAL', 'DISCOUNT', 'OTHER');

-- CreateEnum
CREATE TYPE "AdjustmentBasis" AS ENUM ('BASE_AMOUNT', 'CURRENT_AMOUNT');

-- CreateEnum
CREATE TYPE "RiderAdjustmentTarget" AS ENUM ('RENTAL', 'DEPOSIT');

-- CreateEnum
CREATE TYPE "RiderRuleSelection" AS ENUM ('EXCLUSIVE', 'STACKABLE');

-- CreateEnum
CREATE TYPE "FeeEligibility" AS ENUM ('EVERY_NEW_AGREEMENT', 'FIRST_RENTAL_ONLY', 'ONCE_PER_CLIENT_RIDER_RELATIONSHIP', 'MANUAL');

-- CreateEnum
CREATE TYPE "BatteryPricingType" AS ENUM ('INCLUDED', 'FIXED_SUBSCRIPTION', 'PER_SWAP', 'PER_KM', 'PER_KWH', 'SWAPS_INCLUDED', 'UNLIMITED_SWAP');

-- CreateEnum
CREATE TYPE "RiderCommercialOfferStatus" AS ENUM ('CALCULATED', 'PRESENTED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "RiderRentalAgreementStatus" AS ENUM ('PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'TERMINATION_PENDING', 'TERMINATED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RiderAcceptanceMethod" AS ENUM ('APP_CONFIRMATION', 'OPERATIONS_ASSISTED');

-- CreateEnum
CREATE TYPE "RiderCommercialTermsStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "WalletStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "WalletAccountType" AS ENUM ('CASH', 'SECURITY_DEPOSIT', 'REWARD', 'RECEIVABLE', 'ADJUSTMENT', 'CLEARING', 'PROVIDER_CLEARING');

-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('TOP_UP', 'PAYMENT', 'RENTAL', 'ONBOARDING_FEE', 'SECURITY_DEPOSIT', 'SECURITY_DEPOSIT_REFUND', 'SECURITY_DEPOSIT_DEDUCTION', 'SECURITY_DEPOSIT_FORFEITURE', 'REWARD', 'REFERRAL_REWARD', 'SELF_SUBMISSION_REWARD', 'REFUND', 'PENALTY', 'REPAIR_CHARGE', 'SERVICE_CHARGE', 'BATTERY_CHARGE', 'SWAP_CHARGE', 'EXCHANGE_FEE', 'TRAFFIC_CHALLAN', 'ACCESSORY_CHARGE', 'LOST_EQUIPMENT_CHARGE', 'ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "WalletTransactionStatus" AS ENUM ('CREATED', 'PENDING', 'PROCESSING', 'POSTED', 'FAILED', 'CANCELLED', 'REVERSED', 'PARTIALLY_REVERSED');

-- CreateEnum
CREATE TYPE "WalletEntryType" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "WalletHoldStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CAPTURED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WalletDepositStatus" AS ENUM ('PENDING', 'PARTIALLY_PAID', 'PAID', 'LOCKED', 'PARTIALLY_DEDUCTED', 'REFUND_ELIGIBLE', 'REFUND_REQUESTED', 'REFUNDED', 'FORFEITED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WalletDepositRefundStatus" AS ENUM ('REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'RETURNED', 'FAILED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WalletInvoiceAllocationKind" AS ENUM ('APPLY', 'REVERSAL');

-- CreateEnum
CREATE TYPE "RiderReferenceReviewStatus" AS ENUM ('APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "Client" (
    "fleetOperatingMode" "FleetOperatingMode" NOT NULL DEFAULT 'SIMPLE',
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "companyCode" TEXT,
    "requestedLocales" TEXT[] DEFAULT ARRAY['en']::TEXT[],
    "status" "ClientStatus" NOT NULL DEFAULT 'DRAFT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "depositActivationPolicy" "DepositActivationPolicyType" NOT NULL DEFAULT 'FULL_REQUIRED',
    "depositActivationThreshold" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientSettlementPolicy" (
    "clientId" TEXT NOT NULL,
    "depositApplicationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "manualDepositRefundEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientSettlementPolicy_pkey" PRIMARY KEY ("clientId")
);

-- CreateTable
CREATE TABLE "Oem" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "MasterRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "logoObjectKey" TEXT,
    "website" TEXT,
    "description" TEXT,
    "translations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Oem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkPartnerMaster" (
    "logo" TEXT,
    "category" "WorkPartnerCategory" NOT NULL DEFAULT 'OTHER',
    "workType" TEXT,
    "website" TEXT,
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "status" "MasterRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkPartnerMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientWorkPartner" (
    "logo" TEXT,
    "category" "WorkPartnerCategory" NOT NULL DEFAULT 'OTHER',
    "workType" TEXT,
    "website" TEXT,
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sourceMasterId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "status" "MasterRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientWorkPartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "translations" JSONB,
    "status" "MasterRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleType" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subCategory" TEXT,
    "description" TEXT,
    "translations" JSONB,
    "energyType" "EnergyType" NOT NULL,
    "usageType" "VehicleUsageType",
    "status" "MasterRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Package" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "setupFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "maxFleets" INTEGER NOT NULL DEFAULT 2147483647,
    "maxRiders" INTEGER NOT NULL DEFAULT 2147483647,
    "maxAdmins" INTEGER NOT NULL DEFAULT 2147483647,
    "maxFleetManagers" INTEGER NOT NULL DEFAULT 2147483647,
    "maxHubs" INTEGER NOT NULL DEFAULT 2147483647,
    "maxTeamLeaders" INTEGER NOT NULL DEFAULT 2147483647,
    "maxClusterManagers" INTEGER NOT NULL DEFAULT 2147483647,
    "maxUsers" INTEGER NOT NULL DEFAULT 2147483647,
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feature" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "FeatureCategory" DEFAULT 'OTHER',
    "featureType" "FeatureType" NOT NULL,
    "billingUnit" "FeatureBillingUnit" NOT NULL,
    "description" TEXT,
    "translations" JSONB,
    "configuration" JSONB,
    "featureStepId" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isAddOnEligible" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureStep" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "translations" JSONB,
    "parentId" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureRevision" (
    "id" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageRevision" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackageRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageFeature" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "isIncluded" BOOLEAN NOT NULL DEFAULT true,
    "includedQuantity" DECIMAL(18,4),
    "resetPeriod" "AllowanceResetPeriod" NOT NULL DEFAULT 'NONE',
    "isUnlimited" BOOLEAN NOT NULL DEFAULT false,
    "rolloverAllowed" BOOLEAN NOT NULL DEFAULT false,
    "configuration" JSONB,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackageFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeaturePricing" (
    "id" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "billingUnit" "FeatureBillingUnit" NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "salePrice" DECIMAL(14,4) NOT NULL,
    "costPrice" DECIMAL(14,4),
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeaturePricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageVehicleTierPricing" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "minVehicles" INTEGER NOT NULL,
    "maxVehicles" INTEGER,
    "pricePerVehicle" DECIMAL(14,4) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "billingPeriod" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "tierMode" "PricingTierMode" NOT NULL DEFAULT 'VOLUME',
    "effectiveFrom" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackageVehicleTierPricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureAddOn" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "featureId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "costPrice" DECIMAL(14,4),
    "salePrice" DECIMAL(14,4) NOT NULL,
    "discount" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "validityDays" INTEGER,
    "validityMonths" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureAddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingContent" (
    "id" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "translations" JSONB,
    "imageObjectKey" VARCHAR(500) NOT NULL,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientBusinessProfile" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "legalCompanyName" TEXT NOT NULL,
    "clientType" TEXT NOT NULL,
    "businessType" TEXT NOT NULL,
    "industry" "ClientIndustry",
    "gstin" TEXT,
    "pan" TEXT NOT NULL,
    "cinOrLlpin" TEXT,
    "website" TEXT,
    "logoObjectKey" TEXT,
    "yearEstablished" INTEGER,
    "estimatedFleetSize" INTEGER,
    "estimatedRiderCount" INTEGER,
    "estimatedUserCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientBusinessProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientContact" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "role" "ClientContactRole" NOT NULL,
    "name" TEXT NOT NULL,
    "designation" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "alternateMobile" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientAddress" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" "ClientAddressType" NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "landmark" TEXT,
    "city" TEXT NOT NULL,
    "district" TEXT,
    "state" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'India',
    "pinCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientOperationsProfile" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fleetBusinessModel" "FleetBusinessModel" NOT NULL,
    "numberOfFleets" INTEGER NOT NULL,
    "approximateRiderCount" INTEGER NOT NULL,
    "vehicleOwnership" "VehicleOwnership" NOT NULL,
    "operationalHubCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientOperationsProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientOperationsVehicleCategory" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "operationsProfileId" TEXT NOT NULL,
    "vehicleCategoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientOperationsVehicleCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientBillingProfile" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "billingContactName" TEXT NOT NULL,
    "billingEmail" TEXT NOT NULL,
    "billingMobile" TEXT,
    "purchaseOrderRequired" BOOLEAN NOT NULL DEFAULT false,
    "poNumber" TEXT,
    "paymentTerms" TEXT,
    "taxApplicable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientBillingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientDocument" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "documentType" "ClientDocumentType" NOT NULL,
    "documentNumber" TEXT,
    "issueDate" DATE,
    "expiryDate" DATE,
    "objectKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "verificationStatus" "DocumentVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "uploadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientAgreement" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "authorizedSignatoryName" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "termsAcceptedAt" TIMESTAMP(3) NOT NULL,
    "privacyAcceptedAt" TIMESTAMP(3) NOT NULL,
    "dataProcessingConsentAt" TIMESTAMP(3) NOT NULL,
    "kycConsentAt" TIMESTAMP(3),
    "marketingConsentAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientSubscription" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "packageRevisionId" TEXT,
    "billingCycle" "BillingCycle" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "status" "ClientSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "vehicleCount" INTEGER NOT NULL DEFAULT 0,
    "setupFee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "pricePerVehicle" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "recurringAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tierMinVehicles" INTEGER NOT NULL DEFAULT 0,
    "tierMaxVehicles" INTEGER,
    "tierMode" "PricingTierMode" NOT NULL DEFAULT 'VOLUME',
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientWorkflowRevision" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientWorkflowRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientFeature" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "source" "ClientFeatureSource" NOT NULL DEFAULT 'ADD_ON',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "includedQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "usageLimit" DECIMAL(14,3),
    "unlimitedUsage" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "configuration" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientFeaturePricing" (
    "id" TEXT NOT NULL,
    "clientFeatureId" TEXT NOT NULL,
    "featurePricingId" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "listUnitPrice" DECIMAL(14,4) NOT NULL,
    "discountType" VARCHAR(20),
    "discountValue" DECIMAL(14,4),
    "finalUnitPrice" DECIMAL(14,4) NOT NULL,
    "setupFee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "reason" VARCHAR(500),
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientFeaturePricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientPricingAdjustment" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "adjustmentScope" "PricingAdjustmentScope" NOT NULL,
    "referenceId" TEXT,
    "adjustmentType" "PricingAdjustmentType" NOT NULL,
    "adjustmentValue" DECIMAL(14,4) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientPricingAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientFeatureAddOnPurchase" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "featureAddOnId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "quantityPurchased" DECIMAL(18,4) NOT NULL,
    "quantityConsumed" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "quantityRemaining" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(14,4),
    "amount" DECIMAL(14,2) NOT NULL,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(14,2),
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validFrom" DATE NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),
    "activationReference" VARCHAR(120),
    "status" "FeatureAddOnPurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientFeatureAddOnPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureCreditLot" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "sourceType" "FeatureCreditSourceType" NOT NULL,
    "sourceId" TEXT,
    "sourceKey" TEXT NOT NULL,
    "purchaseId" TEXT,
    "quantityOriginal" DECIMAL(18,4) NOT NULL,
    "quantityAvailable" DECIMAL(18,4) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),
    "periodStart" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureCreditLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureUsageLedger" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "creditLotId" TEXT,
    "sourceType" "FeatureCreditSourceType" NOT NULL,
    "sourceId" TEXT,
    "transactionType" "FeatureUsageTransactionType" NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "balanceAfter" DECIMAL(18,4),
    "referenceType" VARCHAR(100),
    "referenceId" VARCHAR(150),
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATE,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureUsageLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hub" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "type" "HubType" NOT NULL DEFAULT 'OPERATIONS',
    "status" "HubStatus" NOT NULL DEFAULT 'ACTIVE',
    "addressLine1" VARCHAR(255),
    "addressLine2" VARCHAR(255),
    "landmark" VARCHAR(150),
    "city" VARCHAR(100) NOT NULL DEFAULT '',
    "district" VARCHAR(100),
    "state" VARCHAR(100) NOT NULL DEFAULT '',
    "country" VARCHAR(100) NOT NULL DEFAULT 'India',
    "postalCode" VARCHAR(10),
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "location" geography(Point,4326),
    "parentHubId" TEXT,
    "vehicleCapacity" INTEGER,
    "riderCapacity" INTEGER,
    "batteryCapacity" INTEGER,
    "parkingSlots" INTEGER,
    "chargingPoints" INTEGER,
    "swappingPoints" INTEGER,
    "contactName" VARCHAR(150),
    "contactPhone" VARCHAR(20),
    "contactEmail" VARCHAR(150),
    "openingTime" VARCHAR(5),
    "closingTime" VARCHAR(5),
    "is24x7" BOOLEAN NOT NULL DEFAULT false,
    "supportsCharging" BOOLEAN NOT NULL DEFAULT false,
    "supportsBatterySwapping" BOOLEAN NOT NULL DEFAULT false,
    "supportsMaintenance" BOOLEAN NOT NULL DEFAULT false,
    "supportsAllocation" BOOLEAN NOT NULL DEFAULT true,
    "supportsDeallocation" BOOLEAN NOT NULL DEFAULT true,
    "supportsPdi" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fleet" (
    "allocationBlockedByAdmin" BOOLEAN NOT NULL DEFAULT false,
    "readinessApprovedPreparationId" TEXT,
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fleetCode" VARCHAR(50) NOT NULL,
    "vehicleNumber" VARCHAR(30),
    "chassisNumber" VARCHAR(100) NOT NULL,
    "vinNumber" VARCHAR(100),
    "oemId" TEXT NOT NULL,
    "vehicleCategoryId" TEXT NOT NULL,
    "vehicleTypeId" TEXT NOT NULL,
    "speedType" "VehicleSpeedType" NOT NULL,
    "modelName" VARCHAR(100),
    "variantName" VARCHAR(100),
    "colour" VARCHAR(50),
    "manufacturingYear" INTEGER,
    "manufacturingMonth" INTEGER,
    "motorNumber" VARCHAR(100),
    "ownershipType" "FleetOwnershipType" NOT NULL DEFAULT 'CLIENT_OWNED',
    "status" "FleetStatus" NOT NULL DEFAULT 'PENDING_ACTIVATION',
    "readinessWorkflow" "FleetOperatingMode" NOT NULL DEFAULT 'SIMPLE',
    "readinessStagePlanCode" VARCHAR(80),
    "allocationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "homeHubId" TEXT,
    "currentHubId" TEXT,
    "odometerKm" DECIMAL(12,2),
    "iotDeviceId" TEXT,
    "onboardingStatus" "FleetOnboardingStatus" NOT NULL DEFAULT 'DRAFT',
    "onboardedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fleet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetRegistration" (
    "id" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "registrationDate" DATE,
    "registeringAuthority" VARCHAR(150),
    "rcExpiryDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetInsurance" (
    "id" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "providerName" VARCHAR(150),
    "policyNumber" VARCHAR(100),
    "insuranceType" "InsuranceType",
    "startDate" DATE,
    "endDate" DATE,
    "idv" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetInsurance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetFitness" (
    "id" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "certificateNumber" VARCHAR(100),
    "issueDate" DATE,
    "expiryDate" DATE,
    "renewalDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetFitness_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetDocument" (
    "id" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "type" "FleetDocumentType" NOT NULL,
    "documentNumber" VARCHAR(100),
    "objectKey" VARCHAR(500) NOT NULL,
    "issuedAt" DATE,
    "expiresAt" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IoTDevice" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "deviceNumber" VARCHAR(100) NOT NULL,
    "imei" VARCHAR(30),
    "simNumber" VARCHAR(30),
    "iccid" VARCHAR(30),
    "provider" VARCHAR(100),
    "model" VARCHAR(100),
    "ingestSecretHash" TEXT NOT NULL,
    "status" "IoTDeviceStatus" NOT NULL DEFAULT 'UNASSIGNED',
    "installedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastLocationAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IoTDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleCurrentState" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "iotDeviceId" TEXT NOT NULL,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "speedKph" DECIMAL(8,2),
    "ignition" BOOLEAN,
    "batterySoc" INTEGER,
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastLocationAt" TIMESTAMP(3),
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleCurrentState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelemetryEvent" (
    "id" BIGSERIAL NOT NULL,
    "clientId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "type" "IoTEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelemetryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Battery" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "batteryCode" VARCHAR(50),
    "serialNumber" VARCHAR(100) NOT NULL,
    "manufacturer" VARCHAR(100),
    "model" VARCHAR(100),
    "chemistry" "BatteryChemistry",
    "capacityKwh" DECIMAL(8,3),
    "voltage" DECIMAL(8,2),
    "ampHour" DECIMAL(8,2),
    "batteryType" "BatteryType" NOT NULL,
    "status" "BatteryStatus" NOT NULL DEFAULT 'AVAILABLE',
    "manufacturingDate" DATE,
    "warrantyStartDate" DATE,
    "warrantyEndDate" DATE,
    "currentSoc" INTEGER,
    "currentSoh" INTEGER,
    "metadata" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Battery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetBatteryHistory" (
    "id" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "batteryId" TEXT NOT NULL,
    "batterySlot" "BatterySlot" NOT NULL DEFAULT 'PRIMARY',
    "installedAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),
    "installedOdometerKm" DECIMAL(12,2),
    "removedOdometerKm" DECIMAL(12,2),
    "reason" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FleetBatteryHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Controller" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "controllerNumber" VARCHAR(100) NOT NULL,
    "manufacturer" VARCHAR(100),
    "model" VARCHAR(100),
    "ratedVoltage" DECIMAL(8,2),
    "ratedCurrent" DECIMAL(8,2),
    "status" "ControllerStatus" NOT NULL DEFAULT 'AVAILABLE',
    "metadata" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Controller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetControllerHistory" (
    "id" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "controllerId" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),
    "reason" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FleetControllerHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetStatusHistory" (
    "id" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "fromStatus" "FleetStatus",
    "toStatus" "FleetStatus" NOT NULL,
    "changedByUserId" TEXT,
    "reason" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FleetStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetTransfer" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "fromHubId" TEXT,
    "toHubId" TEXT NOT NULL,
    "status" "FleetTransferStatus" NOT NULL DEFAULT 'INITIATED',
    "initiatedById" TEXT,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedById" TEXT,
    "receivedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "mobile" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rider" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "address" TEXT,
    "riderCode" VARCHAR(50),
    "dateOfBirth" DATE,
    "gender" "Gender",
    "addressLine1" VARCHAR(255),
    "addressLine2" VARCHAR(255),
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "postalCode" VARCHAR(10),
    "emergencyContactName" VARCHAR(150),
    "emergencyContactMobile" VARCHAR(20),
    "status" "RiderStatus" NOT NULL DEFAULT 'ONBOARDING',
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "kycVerifiedAt" TIMESTAMP(3),
    "joiningDate" DATE,
    "exitDate" DATE,
    "metadata" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMandate" (
    "id" TEXT NOT NULL,
    "mandateNumber" VARCHAR(50),
    "autoDebitEnabled" BOOLEAN NOT NULL DEFAULT true,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "requestKey" VARCHAR(120) NOT NULL,
    "provider" VARCHAR(30) NOT NULL DEFAULT 'CASHFREE',
    "providerMandateId" VARCHAR(250) NOT NULL,
    "providerKeyId" VARCHAR(100),
    "providerCustomerEmail" VARCHAR(254),
    "providerCustomerId" VARCHAR(100),
    "providerTokenId" VARCHAR(100),
    "providerRegistrationId" VARCHAR(100),
    "providerAuthorizationOrderId" VARCHAR(100),
    "providerAuthorizationPaymentId" VARCHAR(100),
    "authorizationUrl" VARCHAR(1000),
    "providerFrequency" VARCHAR(30),
    "providerTermsSnapshot" JSONB,
    "providerCreateClaimedAt" TIMESTAMP(3),
    "providerCancelRequestedAt" TIMESTAMP(3),
    "providerCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authorizationSessionId" TEXT,
    "status" "PaymentMandateStatus" NOT NULL DEFAULT 'CREATING',
    "providerStatus" VARCHAR(80),
    "mode" VARCHAR(30) NOT NULL DEFAULT 'ON_DEMAND',
    "method" VARCHAR(30) NOT NULL DEFAULT 'UPI_AUTOPAY',
    "maxAmount" DECIMAL(14,2) NOT NULL,
    "authorizationAmount" DECIMAL(14,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "authorizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMandate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMandateEvent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "mandateId" TEXT NOT NULL,
    "fromStatus" "PaymentMandateStatus",
    "toStatus" "PaymentMandateStatus" NOT NULL,
    "source" VARCHAR(40) NOT NULL,
    "referenceId" VARCHAR(120),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentMandateEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentProviderEvent" (
    "deploymentPayload" JSONB,
    "recurringPayload" JSONB,
    "deploymentOrderId" TEXT,
    "id" TEXT NOT NULL,
    "provider" VARCHAR(30) NOT NULL,
    "eventKey" VARCHAR(128) NOT NULL,
    "eventType" VARCHAR(100) NOT NULL,
    "payloadHash" VARCHAR(64) NOT NULL,
    "clientId" TEXT,
    "mandateId" TEXT,
    "paymentTransactionId" TEXT,
    "collectionRequestId" TEXT,
    "status" "PaymentProviderEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "failureReason" VARCHAR(150),

    CONSTRAINT "PaymentProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentTransaction" (
    "id" TEXT NOT NULL,
    "debitNumber" VARCHAR(50),
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "mandateId" TEXT NOT NULL,
    "requestKey" VARCHAR(120) NOT NULL,
    "provider" VARCHAR(30) NOT NULL DEFAULT 'CASHFREE',
    "providerPaymentId" VARCHAR(250) NOT NULL,
    "providerKeyId" VARCHAR(100),
    "providerOrderId" VARCHAR(100),
    "gatewayPaymentId" VARCHAR(100),
    "providerOrderClaimedAt" TIMESTAMP(3),
    "providerDebitClaimedAt" TIMESTAMP(3),
    "providerCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "providerReference" VARCHAR(120),
    "failureCode" VARCHAR(80),
    "retryability" VARCHAR(20),
    "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'CREATING',
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "preDebitNotifiedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "riderPaymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "transactionId" TEXT,
    "collectionRequestId" TEXT,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'CREATING',
    "providerPaymentId" VARCHAR(250) NOT NULL,
    "providerReference" VARCHAR(120),
    "providerStatus" VARCHAR(80),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentCollectionPolicy" (
    "clientId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "collectionTiming" VARCHAR(30) NOT NULL DEFAULT 'ON_DUE_DATE',
    "beforeDueDays" INTEGER NOT NULL DEFAULT 0,
    "collectionHourIst" INTEGER NOT NULL DEFAULT 0,
    "collectionMinuteIst" INTEGER NOT NULL DEFAULT 0,
    "retryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maximumAttempts" INTEGER NOT NULL DEFAULT 1,
    "retryIntervalsDays" JSONB NOT NULL DEFAULT '[]',
    "autoCollectCategories" JSONB NOT NULL DEFAULT '["RECURRING_RENTAL"]',
    "maximumAutoDebit" DECIMAL(14,2),
    "walletFirst" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "PaymentCollectionPolicy_pkey" PRIMARY KEY ("clientId")
);

-- CreateTable
CREATE TABLE "AutoPayDunningCase" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'OPEN',
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "graceUntil" TIMESTAMP(3),
    "failureCode" VARCHAR(80),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoPayDunningCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentCollectionRequest" (
    "id" TEXT NOT NULL,
    "paymentNumber" VARCHAR(50),
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "depositId" TEXT,
    "collectionType" VARCHAR(40) NOT NULL,
    "method" VARCHAR(30) NOT NULL,
    "provider" VARCHAR(30) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'CREATED',
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "paymentSnapshot" JSONB,
    "providerOrderId" VARCHAR(80),
    "providerPaymentId" VARCHAR(120),
    "paymentSessionId" VARCHAR(300),
    "riderPaymentId" TEXT,
    "depositTransactionId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "failureCode" VARCHAR(80),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentCollectionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderPaymentObservation" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "provider" VARCHAR(30) NOT NULL,
    "providerOrderId" VARCHAR(80) NOT NULL,
    "providerPaymentId" VARCHAR(120) NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "amount" DECIMAL(14,2),
    "currency" CHAR(3),
    "reviewCode" VARCHAR(80),
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderPaymentObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderPaymentProfile" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "autoPayEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoSettleInvoiceFromWallet" BOOLEAN NOT NULL DEFAULT false,
    "billingStatus" VARCHAR(30) NOT NULL DEFAULT 'CURRENT',
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "billingMode" VARCHAR(20) NOT NULL DEFAULT 'PREPAID',
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 0,
    "gracePeriodDays" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderPaymentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderCharge" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "sourceKey" VARCHAR(120) NOT NULL,
    "chargeType" VARCHAR(60) NOT NULL,
    "referenceType" VARCHAR(60),
    "referenceId" VARCHAR(120),
    "description" VARCHAR(300) NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unitAmount" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "agreementId" TEXT,
    "commercialVersionId" TEXT,
    "vehicleId" TEXT,
    "servicePeriodStart" TIMESTAMP(3),
    "servicePeriodEnd" TIMESTAMP(3),
    "pricingDetail" JSONB,
    "status" "RiderChargeStatus" NOT NULL DEFAULT 'OPEN',
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderCredit" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "sourceKey" VARCHAR(120) NOT NULL,
    "creditType" VARCHAR(60) NOT NULL,
    "referenceType" VARCHAR(60),
    "referenceId" VARCHAR(120),
    "description" VARCHAR(300) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "remainingAmount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "RiderCreditStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderLedgerEntry" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "entryType" "RiderLedgerEntryType" NOT NULL,
    "category" "RiderLedgerCategory" NOT NULL DEFAULT 'CHARGE_BALANCE',
    "agreementId" TEXT,
    "vehicleId" TEXT,
    "sourceType" VARCHAR(60) NOT NULL,
    "sourceId" VARCHAR(120) NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "debitAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "creditAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderDeposit" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "obligationKey" VARCHAR(160) NOT NULL,
    "depositType" VARCHAR(80) NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "originalRequiredAmount" DECIMAL(14,2) NOT NULL,
    "waiverAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "requiredAmount" DECIMAL(14,2) NOT NULL,
    "fundedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "availableAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "RiderDepositStatus" NOT NULL DEFAULT 'REQUIRED',
    "sourceType" VARCHAR(60) NOT NULL DEFAULT 'RENTAL_AGREEMENT',
    "sourceId" VARCHAR(120) NOT NULL,
    "snapshotLine" JSONB NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderDepositTransaction" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "transactionType" "RiderDepositTransactionType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "balanceDelta" DECIMAL(14,2) NOT NULL,
    "fundingDelta" DECIMAL(14,2) NOT NULL,
    "balanceBefore" DECIMAL(14,2) NOT NULL,
    "balanceAfter" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "referenceType" VARCHAR(80),
    "referenceId" VARCHAR(120),
    "reasonCode" VARCHAR(80),
    "reason" VARCHAR(500),
    "externalReference" VARCHAR(160),
    "paymentMethod" VARCHAR(80),
    "idempotencyKey" VARCHAR(200),
    "transferReferenceId" TEXT,
    "reversalOfTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "RiderDepositTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderDepositRefundRequest" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "RiderDepositRefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" VARCHAR(500) NOT NULL,
    "idempotencyKey" VARCHAR(200) NOT NULL,
    "externalReference" VARCHAR(160),
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "RiderDepositRefundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderInvoice" (
    "penaltyNotificationQueuedAt" TIMESTAMP(3),
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "invoiceNumber" VARCHAR(80) NOT NULL,
    "invoiceType" VARCHAR(40) NOT NULL DEFAULT 'RENTAL',
    "sourceKey" VARCHAR(160),
    "pricingSnapshot" JSONB,
    "agreementId" TEXT,
    "billingPeriodId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "taxSnapshot" JSONB,
    "billingPeriodStart" DATE NOT NULL,
    "billingPeriodEnd" DATE NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "creditAmount" DECIMAL(14,2) NOT NULL,
    "adjustmentAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "appliedSettlementCreditAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "RiderInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "dueDate" DATE NOT NULL,
    "finalizedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderSettlementCreditApplication" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "creditId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderSettlementCreditApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderInvoiceLine" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "kind" "RiderInvoiceLineKind" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "chargeType" VARCHAR(60),
    "commercialVersionId" TEXT,
    "vehicleId" TEXT,
    "servicePeriodStart" TIMESTAMP(3),
    "servicePeriodEnd" TIMESTAMP(3),
    "quantity" DECIMAL(14,4),
    "unit" VARCHAR(20),
    "unitPrice" DECIMAL(14,2),
    "grossAmount" DECIMAL(14,2),
    "discountAmount" DECIMAL(14,2),
    "taxableAmount" DECIMAL(14,2),
    "taxAmount" DECIMAL(14,2),
    "taxSnapshot" JSONB,
    "pricingDetail" JSONB,
    "currency" CHAR(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderBillingSchedule" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "frequency" VARCHAR(20) NOT NULL,
    "customDays" INTEGER,
    "billingMode" VARCHAR(20) NOT NULL,
    "anchorType" VARCHAR(30) NOT NULL,
    "anchorAt" TIMESTAMP(3) NOT NULL,
    "timezone" VARCHAR(80) NOT NULL,
    "nextPeriodStart" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderBillingSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderBillingPeriod" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedAt" TIMESTAMP(3),

    CONSTRAINT "RiderBillingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderTaxProfile" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "supplierState" VARCHAR(80) NOT NULL,
    "supplierGstin" VARCHAR(20),
    "placeOfSupply" VARCHAR(80) NOT NULL,
    "customerGstin" VARCHAR(20),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderTaxProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderTaxRule" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "taxCode" VARCHAR(60) NOT NULL,
    "chargeType" VARCHAR(60) NOT NULL,
    "cgstRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "sgstRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "igstRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "RiderTaxRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderInvoiceSequence" (
    "clientId" TEXT NOT NULL,
    "financialYear" VARCHAR(9) NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RiderInvoiceSequence_pkey" PRIMARY KEY ("clientId","financialYear")
);

-- CreateTable
CREATE TABLE "RiderPayment" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "unallocatedAmount" DECIMAL(14,2) NOT NULL,
    "refundedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "method" VARCHAR(30) NOT NULL,
    "externalReference" VARCHAR(160),
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'CONFIRMED',
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderPaymentAllocation" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "RiderPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRefund" (
    "id" TEXT NOT NULL,
    "refundNumber" VARCHAR(50),
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "treatment" VARCHAR(30) NOT NULL DEFAULT 'PAYMENT_REVERSAL',
    "status" VARCHAR(30) NOT NULL DEFAULT 'CREATING',
    "provider" VARCHAR(30) NOT NULL,
    "providerRefundId" VARCHAR(120) NOT NULL,
    "providerReference" VARCHAR(120),
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderSettlement" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "provider" VARCHAR(30) NOT NULL,
    "providerSettlementId" VARCHAR(160) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "grossAmount" DECIMAL(18,2) NOT NULL,
    "refundAmount" DECIMAL(18,2) NOT NULL,
    "feeAmount" DECIMAL(18,2) NOT NULL,
    "taxAmount" DECIMAL(18,2) NOT NULL,
    "netAmount" DECIMAL(18,2) NOT NULL,
    "settledAt" TIMESTAMP(3) NOT NULL,
    "utr" VARCHAR(160),
    "importHash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'REQUIRES_REVIEW',
    "importedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderSettlementItem" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "providerReference" VARCHAR(160) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "localReferenceId" TEXT,
    "reviewCode" VARCHAR(60),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderSettlementItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderOnboardingProgress" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "currentStepId" TEXT,
    "completedStepIds" JSONB NOT NULL DEFAULT '[]',
    "skippedStepIds" JSONB NOT NULL DEFAULT '[]',
    "values" JSONB NOT NULL DEFAULT '{}',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderOnboardingProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserHub" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserHub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamLeaderProfile" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeCode" VARCHAR(50),
    "designation" VARCHAR(100),
    "joiningDate" DATE,
    "leavingDate" DATE,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TeamLeaderProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamLeaderRider" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "teamLeaderId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamLeaderRider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientOnboardingProgress" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "currentStep" "ClientOnboardingStep" NOT NULL DEFAULT 'HUBS',
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientOnboardingProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientOnboardingStepRecord" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "progressId" TEXT NOT NULL,
    "step" "ClientOnboardingStep" NOT NULL,
    "status" "ClientOnboardingStepStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "savedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientOnboardingStepRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "entityType" "ImportEntityType" NOT NULL,
    "status" "ImportStatus" NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "passedRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "createdRows" INTEGER NOT NULL DEFAULT 0,
    "failureReportKey" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Allocation" (
    "commercialOfferId" TEXT,
    "rentalAgreementId" TEXT,
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "status" "AllocationStatus" NOT NULL DEFAULT 'INITIATED',
    "allocatedAt" TIMESTAMP(3),
    "deallocatedAt" TIMESTAMP(3),
    "initiatedById" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobileDeploymentWorkflow" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "clientWorkPartnerId" TEXT,
    "status" "MobileDeploymentStatus" NOT NULL DEFAULT 'RIDER_WAITING',
    "paymentBreakdown" JSONB,
    "paymentPaidAt" TIMESTAMP(3),
    "pdiChecklist" JSONB,
    "workPartnerName" TEXT,
    "riderPdiAcceptedAt" TIMESTAMP(3),
    "riderPdiRemarksText" TEXT,
    "riderPdiVoicePhotoId" TEXT,
    "trainingViewedContentCodes" JSONB NOT NULL DEFAULT '[]',
    "trainingCompletedAt" TIMESTAMP(3),
    "pairedAt" TIMESTAMP(3),
    "pairingBypassedAt" TIMESTAMP(3),
    "pairingBypassedById" TEXT,
    "pairingBypassReason" TEXT,
    "pairingHealthSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MobileDeploymentWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeploymentPayment" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "status" "DeploymentPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "amount" DECIMAL(14,2) NOT NULL,
    "breakdown" JSONB NOT NULL,
    "provider" TEXT,
    "providerReference" TEXT,
    "submissionVersion" INTEGER NOT NULL DEFAULT 0,
    "rejectionReason" VARCHAR(1000),
    "rejectedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeploymentPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inspection" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "type" "InspectionType" NOT NULL,
    "status" "InspectionStatus" NOT NULL DEFAULT 'DRAFT',
    "checklist" JSONB,
    "completedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "safeForReuse" BOOLEAN,
    "unsafeReason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderKyc" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "type" "KycType" NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "provider" TEXT,
    "providerReference" TEXT,
    "maskedData" JSONB,
    "safeFailureCode" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderKyc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycProviderConfig" (
    "id" TEXT NOT NULL,
    "code" "KycProviderCode" NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "environment" "KycProviderEnvironment" NOT NULL DEFAULT 'TEST',
    "priority" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycProviderCapability" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "verificationType" "KycVerificationType" NOT NULL,
    "isSupported" BOOLEAN NOT NULL DEFAULT false,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "timeoutMs" INTEGER NOT NULL DEFAULT 10000,
    "maxRetries" INTEGER NOT NULL DEFAULT 0,
    "costPerRequest" DECIMAL(12,4),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "billingRule" VARCHAR(40) NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycProviderCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycProviderCredential" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "clientId" TEXT,
    "environment" "KycProviderEnvironment" NOT NULL,
    "secretReference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycProviderCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycConsent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "verificationType" "KycVerificationType" NOT NULL,
    "providerId" TEXT,
    "consentVersion" TEXT NOT NULL,
    "consentTextHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "accepted" BOOLEAN NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "channel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycVerification" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "verificationType" "KycVerificationType" NOT NULL,
    "status" "KycVerificationStatus" NOT NULL DEFAULT 'CREATED',
    "inputFingerprint" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "recoveryVersion" INTEGER NOT NULL DEFAULT 0,
    "consentId" TEXT,
    "finalProviderId" TEXT,
    "finalAttemptId" TEXT,
    "resultCode" TEXT,
    "resultSummary" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "validityDaysSnapshot" INTEGER,
    "reverificationRequiredSnapshot" BOOLEAN NOT NULL DEFAULT false,
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycRecoveryRequest" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycRecoveryRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycClientPolicy" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "verificationType" "KycVerificationType" NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "workflowDefinitionId" TEXT,
    "routingPolicyId" TEXT,
    "validityDays" INTEGER,
    "reverificationRequired" BOOLEAN NOT NULL DEFAULT false,
    "usageRecognition" "KycUsageRecognition" NOT NULL DEFAULT 'ON_REQUEST',
    "overagePolicy" "KycOveragePolicy" NOT NULL DEFAULT 'BLOCK',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycClientPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureUsageConsumption" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "source" "FeatureConsumptionSource" NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "basePrice" DECIMAL(14,4),
    "discount" DECIMAL(14,4),
    "effectivePrice" DECIMAL(14,4),
    "currency" CHAR(3),
    "pricingReferenceId" TEXT,
    "policyId" TEXT,
    "recognition" "KycUsageRecognition" NOT NULL,
    "billingPeriodStart" TIMESTAMP(3) NOT NULL,
    "billingPeriodEnd" TIMESTAMP(3),
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,

    CONSTRAINT "FeatureUsageConsumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycVerificationAttempt" (
    "reason" "KycAttemptReason" NOT NULL DEFAULT 'PRIMARY',
    "isLateCompletion" BOOLEAN NOT NULL DEFAULT false,
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "providerTransactionId" TEXT,
    "requestStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responseReceivedAt" TIMESTAMP(3),
    "latencyMs" INTEGER,
    "httpStatus" INTEGER,
    "providerStatus" TEXT,
    "normalizedStatus" "KycVerificationStatus" NOT NULL DEFAULT 'PROCESSING',
    "failureType" "KycFailureType",
    "failureCategory" TEXT,
    "failureCode" TEXT,
    "cost" DECIMAL(12,4),
    "currency" TEXT,
    "billable" BOOLEAN,
    "costSource" VARCHAR(40),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycVerificationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycProviderSlaPolicy" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "verificationType" "KycVerificationType",
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveUntil" TIMESTAMP(3),
    "availabilityTarget" DECIMAL(5,2),
    "technicalSuccessTarget" DECIMAL(5,2),
    "p95LatencyTargetMs" INTEGER,
    "timeoutRateTarget" DECIMAL(5,2),
    "minimumSampleSize" INTEGER NOT NULL DEFAULT 30,
    "contractReference" VARCHAR(150),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycProviderSlaPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycRoutingPolicy" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "clientId" TEXT,
    "verificationType" "KycVerificationType" NOT NULL,
    "strategy" "KycRoutingStrategy" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL,
    "maxProvidersPerVerification" INTEGER NOT NULL DEFAULT 1,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "allowParallel" BOOLEAN NOT NULL DEFAULT false,
    "allowHedging" BOOLEAN NOT NULL DEFAULT false,
    "arbitrationMode" "KycArbitrationMode",
    "fallbackCategories" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycRoutingPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycRoutingProvider" (
    "id" TEXT NOT NULL,
    "routingPolicyId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "weight" INTEGER,
    "hedgeDelayMs" INTEGER,
    "timeoutMs" INTEGER,
    "maxAttempts" INTEGER,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycRoutingProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycRoutingDecision" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "routingPolicyId" TEXT,
    "routingPolicyVersion" INTEGER NOT NULL,
    "strategy" "KycRoutingStrategy" NOT NULL,
    "selectedProviders" JSONB NOT NULL,
    "decisionReason" TEXT NOT NULL,
    "intelligentPolicyId" TEXT,
    "intelligentMode" TEXT,
    "intelligenceSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycRoutingDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycIntelligentRoutingPolicy" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "version" INTEGER NOT NULL,
    "clientId" TEXT,
    "verificationType" "KycVerificationType" NOT NULL,
    "environment" "KycProviderEnvironment" NOT NULL DEFAULT 'TEST',
    "mode" VARCHAR(20) NOT NULL DEFAULT 'STATIC',
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "weights" JSONB NOT NULL,
    "observationWindowMinutes" INTEGER NOT NULL DEFAULT 60,
    "minimumSampleSize" INTEGER NOT NULL DEFAULT 30,
    "maxSnapshotAgeMinutes" INTEGER NOT NULL DEFAULT 10,
    "latencyTargetMs" INTEGER NOT NULL DEFAULT 1000,
    "unknownCostBehavior" VARCHAR(20) NOT NULL DEFAULT 'NEUTRAL',
    "rolloutPercent" INTEGER NOT NULL DEFAULT 0,
    "maxTechnicalFailurePercent" DECIMAL(5,2),
    "maxP95LatencyMs" INTEGER,
    "sourceShadowPolicyId" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycIntelligentRoutingPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycRoutingMetricSnapshot" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "verificationType" "KycVerificationType" NOT NULL,
    "windowMinutes" INTEGER NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "technicalSuccessRate" DECIMAL(6,5),
    "timeoutRate" DECIMAL(6,5),
    "p95LatencyMs" INTEGER,
    "knownUnitCost" DECIMAL(12,4),
    "currency" CHAR(3),
    "slaStatus" VARCHAR(30),
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycRoutingMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycProviderCircuitState" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "verificationType" "KycVerificationType" NOT NULL,
    "state" VARCHAR(20) NOT NULL DEFAULT 'CLOSED',
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "healthyProbes" INTEGER NOT NULL DEFAULT 0,
    "openUntil" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastProbeAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycProviderCircuitState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycIntelligentRoutingControl" (
    "scopeKey" VARCHAR(120) NOT NULL,
    "disabled" BOOLEAN NOT NULL DEFAULT true,
    "reason" VARCHAR(500) NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycIntelligentRoutingControl_pkey" PRIMARY KEY ("scopeKey")
);

-- CreateTable
CREATE TABLE "KycShadowDecision" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "actualProviderId" TEXT,
    "shadowProviderId" TEXT,
    "scoreSnapshot" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycShadowDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycProviderConflict" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "resultStatus" "KycVerificationStatus" NOT NULL,
    "conflictType" TEXT NOT NULL,
    "resolution" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycProviderConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycVerificationResult" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "verificationType" "KycVerificationType" NOT NULL,
    "status" "KycVerificationStatus" NOT NULL,
    "matchStatus" TEXT,
    "normalizedData" JSONB NOT NULL,
    "providerReference" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycVerificationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycWorkflowDefinition" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "clientId" TEXT,
    "expiryMinutes" INTEGER NOT NULL DEFAULT 43200,
    "matchThresholds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycWorkflowDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycWorkflowStep" (
    "id" TEXT NOT NULL,
    "workflowDefinitionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "verificationType" "KycVerificationType" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "failureBehavior" "KycStepFailureBehavior" NOT NULL DEFAULT 'STOP_WORKFLOW',
    "actionMode" "KycStepActionMode" NOT NULL DEFAULT 'USER_ACTION',
    "retryPolicy" JSONB,
    "conditionConfig" JSONB,
    "timeoutConfig" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycWorkflowStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycWorkflowExecution" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "workflowDefinitionId" TEXT NOT NULL,
    "workflowVersion" INTEGER NOT NULL,
    "status" "KycWorkflowStatus" NOT NULL DEFAULT 'CREATED',
    "reviewPriority" TEXT NOT NULL DEFAULT 'NORMAL',
    "reviewAssignedTo" TEXT,
    "reviewAssignedAt" TIMESTAMP(3),
    "reviewDueAt" TIMESTAMP(3),
    "reviewResolvedAt" TIMESTAMP(3),
    "reviewVersion" INTEGER NOT NULL DEFAULT 0,
    "currentStepId" TEXT,
    "previousWorkflowExecutionId" TEXT,
    "idempotencyKey" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycWorkflowExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycOperationalAlert" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "clientId" TEXT,
    "providerId" TEXT,
    "capability" TEXT,
    "entityId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "acknowledgedBy" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycOperationalAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycWorkflowStepExecution" (
    "id" TEXT NOT NULL,
    "workflowExecutionId" TEXT NOT NULL,
    "workflowStepId" TEXT NOT NULL,
    "verificationId" TEXT,
    "status" "KycStepStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycWorkflowStepExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycDecisionRule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workflowDefinitionId" TEXT,
    "priority" INTEGER NOT NULL,
    "condition" JSONB NOT NULL,
    "action" "KycDecisionOutcome" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycDecisionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycDecision" (
    "id" TEXT NOT NULL,
    "workflowExecutionId" TEXT NOT NULL,
    "decision" "KycDecisionOutcome" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "ruleId" TEXT,
    "summary" TEXT,
    "reviewerId" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycReconciliationResult" (
    "id" TEXT NOT NULL,
    "workflowExecutionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sourceA" TEXT NOT NULL,
    "sourceB" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "score" INTEGER,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycReconciliationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "workFlowType" "PhotoWorkflowType" NOT NULL,
    "subjectType" "PhotoSubjectType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "photoType" "PhotoType" NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "PhotoStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderOnboardingDocument" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "riderId" TEXT,
    "featureId" TEXT NOT NULL,
    "fieldCode" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "status" "RiderDocumentReviewStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderOnboardingDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoRequirement" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "workFlowType" "PhotoWorkflowType" NOT NULL,
    "subjectType" "PhotoSubjectType" NOT NULL,
    "photoType" "PhotoType" NOT NULL,
    "featureCode" VARCHAR(100),
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhotoRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "deviceId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendancePeriod" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT,
    "checkInAt" TIMESTAMP(3) NOT NULL,
    "checkOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendancePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "clientId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "previousData" JSONB,
    "newData" JSONB,
    "requestId" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpRequest" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "purpose" "OtpPurpose" NOT NULL,
    "phone" TEXT NOT NULL,
    "otpHash" TEXT NOT NULL,
    "context" JSONB,
    "status" "OtpStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "requestedIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientDomain" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "type" "ClientDomainType" NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verificationToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientBranding" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "logoObjectKey" TEXT,
    "faviconObjectKey" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#176b4c',
    "secondaryColor" TEXT NOT NULL DEFAULT '#e4f2e9',
    "accentColor" TEXT NOT NULL DEFAULT '#27865f',
    "loginTitle" TEXT NOT NULL DEFAULT 'Welcome back',
    "loginSubtitle" TEXT NOT NULL DEFAULT 'Sign in to your EV fleet workspace.',
    "supportEmail" TEXT,
    "supportPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientBranding_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "RoutingProviderUsage" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "billingMonth" TEXT NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "usageUnits" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutingProviderUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderRateCard" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "status" "RiderRateCardStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "collectFirstRentalUpfront" BOOLEAN NOT NULL DEFAULT true,
    "offerValidityMinutes" INTEGER NOT NULL DEFAULT 60,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderRateCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderRateCardVersion" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "rateCardId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "status" "RiderRateCardStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "description" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderRateCardVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateCardRentalRate" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "rateCardVersionId" TEXT NOT NULL,
    "vehicleCategoryId" TEXT,
    "vehicleTypeId" TEXT,
    "oemId" TEXT,
    "modelName" VARCHAR(100),
    "variantName" VARCHAR(100),
    "fleetId" TEXT,
    "rentalPeriodType" "RentalPeriodType" NOT NULL,
    "durationValue" INTEGER,
    "durationUnit" VARCHAR(20),
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "includedKm" DECIMAL(12,2),
    "extraKmRate" DECIMAL(12,2),
    "taxable" BOOLEAN NOT NULL DEFAULT false,
    "taxCode" TEXT,
    "taxRate" DECIMAL(7,4),
    "priceIncludesTax" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateCardRentalRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateCardFee" (
    "selectionGroup" VARCHAR(80),
    "city" VARCHAR(100),
    "hubId" TEXT,
    "minVehicleAgeMonths" INTEGER,
    "maxVehicleAgeMonths" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "rateCardVersionId" TEXT NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "chargeType" VARCHAR(80) NOT NULL,
    "nature" "RiderChargeNature" NOT NULL,
    "eligibility" "FeeEligibility" NOT NULL DEFAULT 'EVERY_NEW_AGREEMENT',
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "taxable" BOOLEAN NOT NULL DEFAULT false,
    "taxCode" TEXT,
    "taxRate" DECIMAL(7,4),
    "priceIncludesTax" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateCardFee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateCardDeposit" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "rateCardVersionId" TEXT NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "depositType" VARCHAR(80) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "waiverAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "waiverReason" TEXT,
    "guaranteedBy" TEXT,
    "vehicleCategoryId" TEXT,
    "vehicleTypeId" TEXT,
    "fleetId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateCardDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateCardAdjustment" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "rateCardVersionId" TEXT NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "description" TEXT,
    "adjustmentType" "RiderAdjustmentType" NOT NULL,
    "calculationType" "RiderAdjustmentCalculationType" NOT NULL,
    "target" "RiderAdjustmentTarget" NOT NULL DEFAULT 'RENTAL',
    "targetDepositCode" VARCHAR(80),
    "percentageBasis" "AdjustmentBasis" NOT NULL DEFAULT 'BASE_AMOUNT',
    "selection" "RiderRuleSelection" NOT NULL DEFAULT 'EXCLUSIVE',
    "amount" DECIMAL(12,2),
    "percentage" DECIMAL(7,4),
    "maximumDiscount" DECIMAL(12,2),
    "vehicleCategoryId" TEXT,
    "vehicleTypeId" TEXT,
    "oemId" TEXT,
    "modelName" VARCHAR(100),
    "variantName" VARCHAR(100),
    "fleetId" TEXT,
    "country" VARCHAR(100),
    "state" VARCHAR(100),
    "city" VARCHAR(100),
    "zone" VARCHAR(100),
    "hubId" TEXT,
    "minVehicleAgeMonths" INTEGER,
    "maxVehicleAgeMonths" INTEGER,
    "vehicleCommercialGrade" VARCHAR(30),
    "rentalPeriodType" "RentalPeriodType",
    "batteryPlanId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateCardAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderBatteryPlan" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "pricingType" "BatteryPricingType" NOT NULL,
    "rentalPeriodType" "RentalPeriodType",
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "includedSwaps" INTEGER,
    "taxable" BOOLEAN NOT NULL DEFAULT false,
    "taxCode" TEXT,
    "taxRate" DECIMAL(7,4),
    "priceIncludesTax" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderBatteryPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleCommercialGradeAssignment" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "grade" VARCHAR(30) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "reason" TEXT NOT NULL,
    "assessedById" TEXT NOT NULL,
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleCommercialGradeAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderPromotion" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "description" TEXT,
    "calculationType" "RiderAdjustmentCalculationType" NOT NULL,
    "amount" DECIMAL(12,2),
    "percentage" DECIMAL(7,4),
    "maximumDiscount" DECIMAL(12,2),
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "rentalPeriodType" "RentalPeriodType",
    "maxUsage" INTEGER,
    "perRiderUsageLimit" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderPromotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderCommercialTerms" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "version" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "status" "RiderCommercialTermsStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "activatedById" TEXT,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderCommercialTerms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppLegalDocument" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "appCode" VARCHAR(40) NOT NULL,
    "role" "UserRole" NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "locale" VARCHAR(10) NOT NULL,
    "version" VARCHAR(80) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content" TEXT NOT NULL,
    "acceptance" JSONB,
    "contentHash" CHAR(64) NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppLegalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppLegalTemplate" (
    "id" TEXT NOT NULL,
    "appCode" VARCHAR(40) NOT NULL,
    "role" "UserRole" NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "locale" VARCHAR(10) NOT NULL,
    "version" VARCHAR(80) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content" TEXT NOT NULL,
    "acceptance" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppLegalTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppLegalAcceptance" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "deviceId" VARCHAR(128),
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceAcceptedAt" TIMESTAMP(3),
    "contentHash" CHAR(64) NOT NULL,

    CONSTRAINT "AppLegalAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderCommercialOffer" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "offerNumber" VARCHAR(50) NOT NULL,
    "riderId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "hubId" TEXT,
    "rateCardId" TEXT NOT NULL,
    "rateCardVersionId" TEXT NOT NULL,
    "rentalPeriodType" "RentalPeriodType" NOT NULL,
    "durationValue" INTEGER,
    "durationUnit" TEXT,
    "batteryPlanId" TEXT,
    "promotionCode" TEXT,
    "effectiveDate" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "RiderCommercialOfferStatus" NOT NULL DEFAULT 'CALCULATED',
    "finalRecurringAmount" DECIMAL(12,2) NOT NULL,
    "upfrontAmount" DECIMAL(12,2) NOT NULL,
    "refundableAmount" DECIMAL(12,2) NOT NULL,
    "pricingSnapshot" JSONB NOT NULL,
    "pricingSnapshotSchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "calculationHash" CHAR(64) NOT NULL,
    "selectionHash" CHAR(64) NOT NULL,
    "termsVersion" VARCHAR(100) NOT NULL,
    "termsTitle" VARCHAR(200) NOT NULL,
    "termsSnapshot" TEXT NOT NULL,
    "termsHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "presentedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "supersededByOfferId" TEXT,
    "rejectionReason" TEXT,
    "cancellationReason" TEXT,
    "acceptedById" TEXT,
    "rejectedById" TEXT,
    "cancelledById" TEXT,
    "acceptanceMethod" "RiderAcceptanceMethod",
    "riderConsentReference" TEXT,
    "assistedReason" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderCommercialOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderRentalAgreement" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "agreementNumber" VARCHAR(50) NOT NULL,
    "commercialOfferId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "currentVehicleId" TEXT,
    "currentCommercialVersionNumber" INTEGER NOT NULL DEFAULT 1,
    "hubId" TEXT,
    "rateCardId" TEXT NOT NULL,
    "rateCardVersionId" TEXT NOT NULL,
    "rentalPeriodType" "RentalPeriodType" NOT NULL,
    "durationValue" INTEGER,
    "durationUnit" TEXT,
    "batteryPlanId" TEXT,
    "currency" CHAR(3) NOT NULL,
    "startDate" DATE,
    "endDate" DATE,
    "billingAnchorDate" DATE,
    "status" "RiderRentalAgreementStatus" NOT NULL DEFAULT 'PENDING_ACTIVATION',
    "finalRecurringAmount" DECIMAL(12,2) NOT NULL,
    "upfrontAmount" DECIMAL(12,2) NOT NULL,
    "refundableAmount" DECIMAL(12,2) NOT NULL,
    "pricingSnapshot" JSONB NOT NULL,
    "pricingSnapshotSchemaVersion" INTEGER NOT NULL,
    "pricingHash" CHAR(64) NOT NULL,
    "pricingSource" VARCHAR(40) NOT NULL DEFAULT 'COMMERCIAL_OFFER',
    "termsSnapshot" TEXT NOT NULL,
    "termsVersion" VARCHAR(100) NOT NULL,
    "termsTitle" VARCHAR(200) NOT NULL,
    "termsHash" CHAR(64) NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "acceptedById" TEXT NOT NULL,
    "acceptanceMethod" "RiderAcceptanceMethod" NOT NULL,
    "riderConsentReference" TEXT,
    "assistedReason" TEXT,
    "activatedAt" TIMESTAMP(3),
    "terminatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "terminationRequestedAt" TIMESTAMP(3),
    "terminationEffectiveAt" TIMESTAMP(3),
    "terminationReason" TEXT,
    "commercialClosureState" VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    "financiallyClosedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderRentalAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalTerminationRequest" (
    "submissionRequired" BOOLEAN NOT NULL DEFAULT true,
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "allocationId" TEXT,
    "plannedHubId" TEXT,
    "receivedHubId" TEXT,
    "requestedTerminationDate" TIMESTAMP(3) NOT NULL,
    "actualTerminationDate" TIMESTAMP(3),
    "reasonCode" VARCHAR(60) NOT NULL,
    "reasonText" VARCHAR(500),
    "requestedById" TEXT NOT NULL,
    "requestSource" VARCHAR(20) NOT NULL DEFAULT 'STAFF',
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "receiptRecordedAt" TIMESTAMP(3),
    "receiptRecordedById" TEXT,
    "receiptBackdateReason" VARCHAR(500),
    "status" VARCHAR(30) NOT NULL DEFAULT 'REQUESTED',
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalTerminationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnPenaltyPrice" (
    "isSpare" BOOLEAN NOT NULL DEFAULT false,
    "masterSpareId" TEXT,
    "sourceVersion" INTEGER,
    "name" VARCHAR(180),
    "baseRate" DECIMAL(14,2),
    "gstPercent" DECIMAL(5,2),
    "hsnCode" VARCHAR(20),
    "unit" VARCHAR(30) NOT NULL DEFAULT 'PIECE',
    "vehicleTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "configurationVersion" INTEGER NOT NULL DEFAULT 1,
    "penaltyConfigured" BOOLEAN NOT NULL DEFAULT true,
    "evidenceRequired" BOOLEAN NOT NULL DEFAULT true,
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "category" VARCHAR(30) NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnPenaltyPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnPenaltyCase" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "terminationRequestId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "currentRevision" INTEGER NOT NULL DEFAULT 0,
    "digest" CHAR(64),
    "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "status" VARCHAR(40) NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "riderDisputedRevision" INTEGER,
    "riderDisputedAt" TIMESTAMP(3),
    "riderDisputeReason" VARCHAR(500),
    "managerApprovedRevision" INTEGER,
    "managerApprovedAt" TIMESTAMP(3),
    "managerApprovedById" TEXT,
    "postedRevision" INTEGER,
    "postedChargeId" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnPenaltyCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnPenaltyItem" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "priceListItemId" TEXT NOT NULL,
    "priceCode" VARCHAR(60),
    "category" VARCHAR(30),
    "description" VARCHAR(300),
    "amount" DECIMAL(14,2),
    "currency" CHAR(3),
    "details" VARCHAR(1000) NOT NULL,
    "evidencePhotoIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "ReturnPenaltyItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "hubId" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "subject" VARCHAR(160) NOT NULL,
    "description" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportReply" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderFinalSettlement" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "settlementNumber" VARCHAR(80) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "terminationDate" TIMESTAMP(3) NOT NULL,
    "billingCutoffAt" TIMESTAMP(3) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "snapshot" JSONB,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderFinalSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementRevision" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementChargeAssessment" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "chargeType" VARCHAR(60) NOT NULL,
    "sourceType" VARCHAR(60),
    "sourceId" VARCHAR(120),
    "description" VARCHAR(300) NOT NULL,
    "assessedAmount" DECIMAL(14,2) NOT NULL,
    "approvedAmount" DECIMAL(14,2),
    "status" VARCHAR(30) NOT NULL DEFAULT 'ASSESSED',
    "evidence" JSONB,
    "assessedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "SettlementChargeAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementDepositHold" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "holdUntil" TIMESTAMP(3),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "SettlementDepositHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementDepositApplication" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "depositTransactionId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementDepositApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementRefundRequest" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "depositId" TEXT,
    "depositRefundId" TEXT,
    "paymentId" TEXT,
    "paymentRefundId" TEXT,
    "refundType" VARCHAR(40) NOT NULL,
    "destinationType" VARCHAR(40) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'REQUESTED',
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "externalReference" VARCHAR(160),
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "failureReason" VARCHAR(500),

    CONSTRAINT "SettlementRefundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementAdjustment" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "type" VARCHAR(10) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "SettlementAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderFinancialNote" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "agreementId" TEXT,
    "invoiceId" TEXT,
    "noteNumber" VARCHAR(80) NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "reasonCode" VARCHAR(60) NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "taxSnapshot" JSONB,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ISSUED',
    "sourceId" TEXT,
    "createdById" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderFinancialNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementSequence" (
    "clientId" TEXT NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "year" VARCHAR(9) NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SettlementSequence_pkey" PRIMARY KEY ("clientId","kind","year")
);

-- CreateTable
CREATE TABLE "RiderRentalAgreementStatusHistory" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "previousStatus" "RiderRentalAgreementStatus",
    "newStatus" "RiderRentalAgreementStatus" NOT NULL,
    "reason" TEXT,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderRentalAgreementStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderRentalAgreementAmendment" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "amendmentNumber" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "previousPricingHash" CHAR(64) NOT NULL,
    "proposedPricingHash" CHAR(64) NOT NULL,
    "proposedPricingSnapshot" JSONB NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "exchangeRequestId" TEXT,
    "previousVehicleId" TEXT,
    "replacementVehicleId" TEXT,
    "effectiveAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "commercialDifference" JSONB,

    CONSTRAINT "RiderRentalAgreementAmendment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientExchangePolicy" (
    "clientId" TEXT NOT NULL,
    "exchangeAllowed" BOOLEAN NOT NULL DEFAULT false,
    "minimumDaysOnVehicle" INTEGER NOT NULL DEFAULT 0,
    "prorationMode" "ExchangeProrationMode" NOT NULL DEFAULT 'NONE',
    "prorationPolicy" "ExchangeProrationPolicy" NOT NULL DEFAULT 'NO_PRORATION',
    "depositExcessPolicy" "ExchangeDepositExcessPolicy" NOT NULL DEFAULT 'REFUND_REQUEST',
    "exchangeFeeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeWaiverReasonCodes" JSONB NOT NULL DEFAULT '[]',
    "offerValidityMinutes" INTEGER NOT NULL DEFAULT 60,
    "reservationMinutes" INTEGER NOT NULL DEFAULT 120,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientExchangePolicy_pkey" PRIMARY KEY ("clientId")
);

-- CreateTable
CREATE TABLE "RiderAgreementCommercialVersion" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "rateCardVersionId" TEXT NOT NULL,
    "pricingSnapshot" JSONB NOT NULL,
    "pricingHash" CHAR(64) NOT NULL,
    "termsVersion" VARCHAR(100) NOT NULL,
    "termsHash" CHAR(64) NOT NULL,
    "termsSnapshot" TEXT NOT NULL,
    "termsTitle" VARCHAR(200) NOT NULL,
    "recurringAmount" DECIMAL(12,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "billingStartAt" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "amendmentId" TEXT,
    "status" VARCHAR(20) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderAgreementCommercialVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleExchangeRequest" (
    "submissionRequired" BOOLEAN NOT NULL DEFAULT true,
    "plannedHubId" TEXT,
    "plannedReturnDate" TIMESTAMP(3),
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "oldVehicleId" TEXT NOT NULL,
    "replacementVehicleId" TEXT,
    "replacementSelection" JSONB,
    "baseVersionNumber" INTEGER NOT NULL,
    "reasonCode" VARCHAR(80) NOT NULL,
    "reason" TEXT,
    "status" "VehicleExchangeStatus" NOT NULL DEFAULT 'REQUESTED',
    "oldAllocationId" TEXT,
    "returnInspectionId" TEXT,
    "newAllocationId" TEXT,
    "proposedEffectiveAt" TIMESTAMP(3),
    "effectiveAt" TIMESTAMP(3),
    "reservationExpiresAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleExchangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleExchangeOffer" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "exchangeRequestId" TEXT NOT NULL,
    "status" "VehicleExchangeOfferStatus" NOT NULL DEFAULT 'PRESENTED',
    "pricingSnapshot" JSONB NOT NULL,
    "pricingHash" CHAR(64) NOT NULL,
    "commercialDifference" JSONB NOT NULL,
    "offerHash" CHAR(64) NOT NULL,
    "termsSnapshot" TEXT NOT NULL,
    "termsTitle" VARCHAR(200) NOT NULL,
    "termsHash" CHAR(64) NOT NULL,
    "termsVersion" VARCHAR(100) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "acceptanceMethod" "RiderAcceptanceMethod",
    "riderConsentReference" TEXT,
    "assistedReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleExchangeOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionPolicy" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionPolicyVersion" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "gracePeriodDays" INTEGER NOT NULL DEFAULT 0,
    "dunningEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoPayRetryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "promiseToPayEnabled" BOOLEAN NOT NULL DEFAULT false,
    "promiseHoldEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maximumPromiseDays" INTEGER NOT NULL DEFAULT 14,
    "lateFeeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "restrictionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maximumMessagesPerDay" INTEGER NOT NULL DEFAULT 1,
    "minimumMessageIntervalHours" INTEGER NOT NULL DEFAULT 24,
    "communicationStartHour" INTEGER NOT NULL DEFAULT 8,
    "communicationEndHour" INTEGER NOT NULL DEFAULT 20,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionPolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionPolicyStage" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "stageCode" TEXT NOT NULL,
    "stageName" TEXT NOT NULL,
    "daysFromDue" INTEGER NOT NULL,
    "severity" INTEGER NOT NULL DEFAULT 0,
    "displayOrder" INTEGER NOT NULL,
    "actions" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CollectionPolicyStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderCollectionCase" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "agreementId" TEXT,
    "policyVersionId" TEXT NOT NULL,
    "caseNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "delinquencyState" TEXT NOT NULL,
    "totalOutstanding" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "overdueOutstanding" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "oldestDueDate" DATE,
    "daysPastDue" INTEGER NOT NULL DEFAULT 0,
    "currentStage" TEXT,
    "assignedToId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "assignedById" TEXT,
    "nextActionAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolutionType" TEXT,
    "activeRiderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderCollectionCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionCaseInvoice" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionCaseInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionAction" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "stageCode" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "executedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "result" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromiseToPay" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "promisedAmount" DECIMAL(14,2) NOT NULL,
    "baselinePaidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paidSince" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "promiseDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "activeCaseId" TEXT,
    "source" TEXT NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilledAt" TIMESTAMP(3),
    "brokenAt" TIMESTAMP(3),

    CONSTRAINT "PromiseToPay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionCaseNote" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "noteType" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionCaseNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionTask" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "assignedToId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "result" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionWaiver" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "waiverType" TEXT NOT NULL,
    "amount" DECIMAL(14,2),
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionWaiver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LateFeePolicy" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "feeType" TEXT NOT NULL DEFAULT 'NONE',
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "minimumDaysPastDue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LateFeePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionDispute" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "CollectionDispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialRestriction" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'COLLECTION_CASE',
    "sourceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECOMMENDED',
    "appliedById" TEXT,
    "appliedAt" TIMESTAMP(3),
    "removedById" TEXT,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommercialRestriction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionEvent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionEvaluationQueue" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionEvaluationQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderWallet" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "status" "WalletStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "RiderWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletAccount" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "accountType" "WalletAccountType" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "WalletStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "transactionNumber" VARCHAR(60) NOT NULL,
    "transactionType" "WalletTransactionType" NOT NULL,
    "status" "WalletTransactionStatus" NOT NULL DEFAULT 'CREATED',
    "currency" CHAR(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "referenceType" VARCHAR(60),
    "referenceId" VARCHAR(120),
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "parentTransactionId" TEXT,
    "metadata" JSONB,
    "postedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletLedgerEntry" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "entryType" "WalletEntryType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "description" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "WalletLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletHold" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "capturedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "status" "WalletHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "referenceType" VARCHAR(60),
    "referenceId" VARCHAR(120),
    "reason" VARCHAR(300) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletPolicy" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "allowNegativeCashBalance" BOOLEAN NOT NULL DEFAULT false,
    "negativeBalanceLimit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "minimumCashBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "allowRewardUsage" BOOLEAN NOT NULL DEFAULT false,
    "maxRewardUsagePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "rewardCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowDepositDeduction" BOOLEAN NOT NULL DEFAULT false,
    "depositDeductionReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowPartialSecurityDeposit" BOOLEAN NOT NULL DEFAULT true,
    "requireFullDepositBeforeAllocation" BOOLEAN NOT NULL DEFAULT false,
    "allowDepositRefundRequest" BOOLEAN NOT NULL DEFAULT false,
    "fundingPriority" TEXT[] DEFAULT ARRAY['REWARD', 'CASH', 'EXTERNAL_PAYMENT']::TEXT[],
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletSecurityDeposit" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "requiredAmount" DECIMAL(18,2) NOT NULL,
    "sourceType" VARCHAR(60) NOT NULL,
    "sourceId" VARCHAR(120) NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "status" "WalletDepositStatus" NOT NULL DEFAULT 'PENDING',
    "lockedAt" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "WalletSecurityDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletDepositRefundRequest" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" "WalletDepositRefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" VARCHAR(500) NOT NULL,
    "destinationType" VARCHAR(40) NOT NULL DEFAULT 'WALLET_CASH',
    "externalReference" VARCHAR(160),
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletDepositRefundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletInvoiceAllocation" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "kind" "WalletInvoiceAllocationKind" NOT NULL DEFAULT 'APPLY',
    "sourceType" VARCHAR(30) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reversalOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "WalletInvoiceAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardProgram" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "totalBudget" DECIMAL(18,2),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardRule" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "triggerType" VARCHAR(60) NOT NULL,
    "rewardType" VARCHAR(20) NOT NULL DEFAULT 'FIXED',
    "rewardValue" DECIMAL(18,2) NOT NULL,
    "approvalMode" VARCHAR(30) NOT NULL DEFAULT 'MANUAL_APPROVAL',
    "expiryDays" INTEGER,
    "expiryAt" TIMESTAMP(3),
    "monthlyCountCap" INTEGER,
    "monthlyAmountCap" DECIMAL(18,2),
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardClaim" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "sourceType" VARCHAR(40) NOT NULL,
    "sourceId" VARCHAR(120) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'APPROVAL_PENDING',
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "calculatedAmount" DECIMAL(18,2) NOT NULL,
    "creditedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unrecoveredAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "snapshot" JSONB NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "creditedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "rejectionReason" VARCHAR(500),
    "walletTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardLot" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "originalAmount" DECIMAL(18,2) NOT NULL,
    "remainingAmount" DECIMAL(18,2) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "status" VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardLotConsumption" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "kind" VARCHAR(20) NOT NULL DEFAULT 'SPEND',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardLotConsumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardEvent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderReferenceReview" (
    "id" VARCHAR(64) NOT NULL,
    "clientId" TEXT NOT NULL,
    "ownerKey" VARCHAR(100) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "mobile" VARCHAR(20) NOT NULL,
    "relation" VARCHAR(80) NOT NULL,
    "status" "RiderReferenceReviewStatus" NOT NULL,
    "rejectionReason" VARCHAR(1000),
    "reviewedById" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderReferenceReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleSubmission" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "returnRequestId" TEXT,
    "exchangeRequestId" TEXT,
    "riderId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'IN_PROGRESS',
    "assetSnapshot" JSONB NOT NULL,
    "requiredPhotoTypes" TEXT[],
    "mechanicChecksComplete" BOOLEAN NOT NULL DEFAULT false,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleSubmissionReport" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "requestKey" VARCHAR(120) NOT NULL,
    "stage" VARCHAR(10) NOT NULL,
    "mechanicName" VARCHAR(150) NOT NULL,
    "summary" VARCHAR(4000) NOT NULL,
    "fleetStatus" "FleetStatus",
    "safeForReuse" BOOLEAN NOT NULL,
    "unsafeReason" VARCHAR(500),
    "checksComplete" BOOLEAN NOT NULL DEFAULT false,
    "evidencePhotoIds" TEXT[],
    "items" JSONB NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "digest" CHAR(64) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "recordedById" TEXT NOT NULL,
    "imposedById" TEXT,
    "imposedAt" TIMESTAMP(3),
    "riderOtpRequestId" TEXT,
    "riderVerifiedUserId" TEXT,
    "teamLeadOtpRequestId" TEXT,
    "teamLeadVerifiedUserId" TEXT,
    "riderBypassReason" VARCHAR(500),
    "teamLeadBypassReason" VARCHAR(500),
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "postedChargeId" TEXT,
    "cancelledById" TEXT,
    "cancellationReason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleSubmissionReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushDevice" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "installationId" UUID NOT NULL,
    "appCode" VARCHAR(30) NOT NULL,
    "platform" VARCHAR(10) NOT NULL,
    "token" TEXT NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRegisteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabledReason" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationMessage" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "senderId" TEXT,
    "title" VARCHAR(150) NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "audience" VARCHAR(30) NOT NULL,
    "audiencePhones" TEXT[],
    "requestKey" VARCHAR(150) NOT NULL,
    "requestDigest" CHAR(64) NOT NULL,
    "source" VARCHAR(50) NOT NULL DEFAULT 'MANUAL',
    "status" VARCHAR(40) NOT NULL DEFAULT 'QUEUED',
    "totalUsers" INTEGER NOT NULL DEFAULT 0,
    "pushExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "NotificationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNotification" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "expandedAt" TIMESTAMP(3),
    "noActiveDevice" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushDelivery" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userNotificationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceVersion" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstAttemptAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "claimId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "firebaseMessageId" TEXT,
    "errorCode" VARCHAR(150),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushDispatchState" (
    "id" TEXT NOT NULL,
    "nextAllowedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "claimId" TEXT,

    CONSTRAINT "PushDispatchState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetManagerHomeHistory" (
    "id" BIGSERIAL NOT NULL,
    "clientId" TEXT NOT NULL,
    "entityType" VARCHAR(40) NOT NULL,
    "entityId" TEXT NOT NULL,
    "recordedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "data" JSONB,

    CONSTRAINT "FleetManagerHomeHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetManagerHomeHistoryCoverage" (
    "id" TEXT NOT NULL DEFAULT 'initial',
    "availableFrom" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "FleetManagerHomeHistoryCoverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PenaltyHandoverException" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "debtDigest" CHAR(64) NOT NULL,
    "debtSnapshot" JSONB NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "PenaltyHandoverException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetReadinessPolicy" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "configuration" JSONB NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FleetReadinessPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetReadinessStaff" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "canPrepare" BOOLEAN NOT NULL DEFAULT false,
    "canReview" BOOLEAN NOT NULL DEFAULT false,
    "stageCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reviewStageCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "FleetReadinessStaff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetPreparation" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    "assignedToId" TEXT,
    "currentRevision" INTEGER NOT NULL DEFAULT 1,
    "policySnapshot" JSONB NOT NULL,
    "invalidationReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetPreparation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetPreparationRevision" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "checklist" JSONB NOT NULL DEFAULT '{}',
    "componentSnapshot" JSONB,
    "photoIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "decision" TEXT,
    "rejectionReason" TEXT,
    "failedItems" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FleetPreparationRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetPreparationEvent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FleetPreparationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetInstallationStage" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "assignedToId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "definition" JSONB NOT NULL,
    "checklist" JSONB NOT NULL DEFAULT '{}',
    "componentSnapshot" JSONB,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reason" TEXT,
    "failedItems" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "history" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetInstallationStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SparePartMaster" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "baseRate" DECIMAL(14,2) NOT NULL,
    "gstPercent" DECIMAL(5,2) NOT NULL,
    "hsnCode" VARCHAR(20) NOT NULL,
    "unit" VARCHAR(30) NOT NULL DEFAULT 'PIECE',
    "vehicleTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SparePartMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpareCatalogueRevision" (
    "id" TEXT NOT NULL,
    "masterSpareId" TEXT,
    "priceId" TEXT,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpareCatalogueRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RazorpayDeploymentOrder" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "deploymentPaymentId" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "providerOrderId" TEXT,
    "amountPaise" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'CREATING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RazorpayDeploymentOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RazorpayDeploymentCapture" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "providerPaymentId" TEXT NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "reason" VARCHAR(150),
    "providerRefundId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RazorpayDeploymentCapture_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "RazorpayAutoPayCapture" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "providerPaymentId" VARCHAR(120) NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "reason" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RazorpayAutoPayCapture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Client_slug_key" ON "Client"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Client_companyCode_key" ON "Client"("companyCode");

-- CreateIndex
CREATE UNIQUE INDEX "Oem_code_key" ON "Oem"("code");

-- CreateIndex
CREATE INDEX "Oem_status_displayName_idx" ON "Oem"("status", "displayName");

-- CreateIndex
CREATE UNIQUE INDEX "WorkPartnerMaster_code_key" ON "WorkPartnerMaster"("code");

-- CreateIndex
CREATE INDEX "WorkPartnerMaster_status_name_idx" ON "WorkPartnerMaster"("status", "name");

-- CreateIndex
CREATE INDEX "ClientWorkPartner_clientId_status_name_idx" ON "ClientWorkPartner"("clientId", "status", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ClientWorkPartner_clientId_id_key" ON "ClientWorkPartner"("clientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ClientWorkPartner_clientId_code_key" ON "ClientWorkPartner"("clientId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleCategory_code_key" ON "VehicleCategory"("code");

-- CreateIndex
CREATE INDEX "VehicleCategory_status_displayOrder_name_idx" ON "VehicleCategory"("status", "displayOrder", "name");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleType_code_key" ON "VehicleType"("code");

-- CreateIndex
CREATE INDEX "VehicleType_categoryId_status_name_idx" ON "VehicleType"("categoryId", "status", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Package_code_key" ON "Package"("code");

-- CreateIndex
CREATE INDEX "Package_isActive_isCustom_displayOrder_idx" ON "Package"("isActive", "isCustom", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Feature_code_key" ON "Feature"("code");

-- CreateIndex
CREATE INDEX "Feature_isActive_category_displayOrder_idx" ON "Feature"("isActive", "category", "displayOrder");

-- CreateIndex
CREATE INDEX "Feature_featureStepId_idx" ON "Feature"("featureStepId");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureStep_code_key" ON "FeatureStep"("code");

-- CreateIndex
CREATE INDEX "FeatureStep_parentId_isActive_displayOrder_idx" ON "FeatureStep"("parentId", "isActive", "displayOrder");

-- CreateIndex
CREATE INDEX "FeatureRevision_featureId_publishedAt_idx" ON "FeatureRevision"("featureId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureRevision_featureId_version_key" ON "FeatureRevision"("featureId", "version");

-- CreateIndex
CREATE INDEX "PackageRevision_packageId_publishedAt_idx" ON "PackageRevision"("packageId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PackageRevision_packageId_version_key" ON "PackageRevision"("packageId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PackageFeature_packageId_featureId_key" ON "PackageFeature"("packageId", "featureId");

-- CreateIndex
CREATE INDEX "FeaturePricing_featureId_isActive_effectiveFrom_idx" ON "FeaturePricing"("featureId", "isActive", "effectiveFrom");

-- CreateIndex
CREATE INDEX "PackageVehicleTierPricing_packageId_isActive_effectiveFrom_idx" ON "PackageVehicleTierPricing"("packageId", "isActive", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PackageVehicleTierPricing_packageId_minVehicles_effectiveFr_key" ON "PackageVehicleTierPricing"("packageId", "minVehicles", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureAddOn_code_key" ON "FeatureAddOn"("code");

-- CreateIndex
CREATE INDEX "FeatureAddOn_featureId_isActive_effectiveFrom_idx" ON "FeatureAddOn"("featureId", "isActive", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingContent_code_key" ON "TrainingContent"("code");

-- CreateIndex
CREATE INDEX "TrainingContent_featureId_isActive_displayOrder_idx" ON "TrainingContent"("featureId", "isActive", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ClientBusinessProfile_clientId_key" ON "ClientBusinessProfile"("clientId");

-- CreateIndex
CREATE INDEX "ClientContact_clientId_role_idx" ON "ClientContact"("clientId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ClientContact_clientId_role_key" ON "ClientContact"("clientId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ClientAddress_clientId_type_key" ON "ClientAddress"("clientId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ClientOperationsProfile_clientId_key" ON "ClientOperationsProfile"("clientId");

-- CreateIndex
CREATE INDEX "ClientOperationsVehicleCategory_clientId_vehicleCategoryId_idx" ON "ClientOperationsVehicleCategory"("clientId", "vehicleCategoryId");

-- CreateIndex
CREATE INDEX "ClientOperationsVehicleCategory_vehicleCategoryId_idx" ON "ClientOperationsVehicleCategory"("vehicleCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientOperationsVehicleCategory_operationsProfileId_vehicle_key" ON "ClientOperationsVehicleCategory"("operationsProfileId", "vehicleCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientBillingProfile_clientId_key" ON "ClientBillingProfile"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientDocument_objectKey_key" ON "ClientDocument"("objectKey");

-- CreateIndex
CREATE INDEX "ClientDocument_clientId_documentType_verificationStatus_idx" ON "ClientDocument"("clientId", "documentType", "verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ClientAgreement_clientId_key" ON "ClientAgreement"("clientId");

-- CreateIndex
CREATE INDEX "ClientSubscription_clientId_status_idx" ON "ClientSubscription"("clientId", "status");

-- CreateIndex
CREATE INDEX "ClientWorkflowRevision_subscriptionId_publishedAt_idx" ON "ClientWorkflowRevision"("subscriptionId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClientWorkflowRevision_subscriptionId_version_key" ON "ClientWorkflowRevision"("subscriptionId", "version");

-- CreateIndex
CREATE INDEX "ClientFeature_clientId_enabled_effectiveFrom_idx" ON "ClientFeature"("clientId", "enabled", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ClientFeature_featureId_idx" ON "ClientFeature"("featureId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientFeature_subscriptionId_featureId_key" ON "ClientFeature"("subscriptionId", "featureId");

-- CreateIndex
CREATE INDEX "ClientFeaturePricing_clientFeatureId_effectiveFrom_idx" ON "ClientFeaturePricing"("clientFeatureId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ClientFeaturePricing_featurePricingId_idx" ON "ClientFeaturePricing"("featurePricingId");

-- CreateIndex
CREATE INDEX "ClientPricingAdjustment_clientId_adjustmentScope_isActive_v_idx" ON "ClientPricingAdjustment"("clientId", "adjustmentScope", "isActive", "validFrom");

-- CreateIndex
CREATE INDEX "ClientPricingAdjustment_subscriptionId_isActive_validFrom_idx" ON "ClientPricingAdjustment"("subscriptionId", "isActive", "validFrom");

-- CreateIndex
CREATE INDEX "ClientFeatureAddOnPurchase_clientId_featureId_status_expire_idx" ON "ClientFeatureAddOnPurchase"("clientId", "featureId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "ClientFeatureAddOnPurchase_subscriptionId_status_idx" ON "ClientFeatureAddOnPurchase"("subscriptionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClientFeatureAddOnPurchase_clientId_activationReference_key" ON "ClientFeatureAddOnPurchase"("clientId", "activationReference");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureCreditLot_sourceKey_key" ON "FeatureCreditLot"("sourceKey");

-- CreateIndex
CREATE INDEX "FeatureCreditLot_clientId_featureId_quantityAvailable_expir_idx" ON "FeatureCreditLot"("clientId", "featureId", "quantityAvailable", "expiresAt");

-- CreateIndex
CREATE INDEX "FeatureCreditLot_subscriptionId_featureId_periodStart_idx" ON "FeatureCreditLot"("subscriptionId", "featureId", "periodStart");

-- CreateIndex
CREATE INDEX "FeatureUsageLedger_clientId_featureId_occurredAt_idx" ON "FeatureUsageLedger"("clientId", "featureId", "occurredAt");

-- CreateIndex
CREATE INDEX "FeatureUsageLedger_subscriptionId_featureId_occurredAt_idx" ON "FeatureUsageLedger"("subscriptionId", "featureId", "occurredAt");

-- CreateIndex
CREATE INDEX "FeatureUsageLedger_creditLotId_occurredAt_idx" ON "FeatureUsageLedger"("creditLotId", "occurredAt");

-- CreateIndex
CREATE INDEX "Hub_clientId_status_idx" ON "Hub"("clientId", "status");

-- CreateIndex
CREATE INDEX "Hub_clientId_city_idx" ON "Hub"("clientId", "city");

-- CreateIndex
CREATE INDEX "Hub_parentHubId_idx" ON "Hub"("parentHubId");

-- CreateIndex
CREATE UNIQUE INDEX "Hub_clientId_code_key" ON "Hub"("clientId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Fleet_iotDeviceId_key" ON "Fleet"("iotDeviceId");

-- CreateIndex
CREATE INDEX "Fleet_clientId_status_idx" ON "Fleet"("clientId", "status");

-- CreateIndex
CREATE INDEX "Fleet_clientId_oemId_idx" ON "Fleet"("clientId", "oemId");

-- CreateIndex
CREATE INDEX "Fleet_clientId_vehicleCategoryId_idx" ON "Fleet"("clientId", "vehicleCategoryId");

-- CreateIndex
CREATE INDEX "Fleet_clientId_vehicleTypeId_idx" ON "Fleet"("clientId", "vehicleTypeId");

-- CreateIndex
CREATE INDEX "Fleet_clientId_speedType_idx" ON "Fleet"("clientId", "speedType");

-- CreateIndex
CREATE INDEX "Fleet_clientId_currentHubId_idx" ON "Fleet"("clientId", "currentHubId");

-- CreateIndex
CREATE INDEX "Fleet_clientId_homeHubId_idx" ON "Fleet"("clientId", "homeHubId");

-- CreateIndex
CREATE INDEX "Fleet_clientId_onboardingStatus_idx" ON "Fleet"("clientId", "onboardingStatus");

-- CreateIndex
CREATE INDEX "Fleet_clientId_allocationEnabled_idx" ON "Fleet"("clientId", "allocationEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "Fleet_clientId_fleetCode_key" ON "Fleet"("clientId", "fleetCode");

-- CreateIndex
CREATE UNIQUE INDEX "Fleet_clientId_id_key" ON "Fleet"("clientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Fleet_clientId_vehicleNumber_key" ON "Fleet"("clientId", "vehicleNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Fleet_clientId_chassisNumber_key" ON "Fleet"("clientId", "chassisNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Fleet_clientId_vinNumber_key" ON "Fleet"("clientId", "vinNumber");

-- CreateIndex
CREATE UNIQUE INDEX "FleetRegistration_fleetId_key" ON "FleetRegistration"("fleetId");

-- CreateIndex
CREATE UNIQUE INDEX "FleetInsurance_fleetId_key" ON "FleetInsurance"("fleetId");

-- CreateIndex
CREATE UNIQUE INDEX "FleetFitness_fleetId_key" ON "FleetFitness"("fleetId");

-- CreateIndex
CREATE INDEX "FleetDocument_fleetId_type_idx" ON "FleetDocument"("fleetId", "type");

-- CreateIndex
CREATE INDEX "FleetDocument_expiresAt_idx" ON "FleetDocument"("expiresAt");

-- CreateIndex
CREATE INDEX "IoTDevice_clientId_status_idx" ON "IoTDevice"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "IoTDevice_clientId_deviceNumber_key" ON "IoTDevice"("clientId", "deviceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleCurrentState_fleetId_key" ON "VehicleCurrentState"("fleetId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleCurrentState_iotDeviceId_key" ON "VehicleCurrentState"("iotDeviceId");

-- CreateIndex
CREATE INDEX "VehicleCurrentState_clientId_lastHeartbeatAt_idx" ON "VehicleCurrentState"("clientId", "lastHeartbeatAt");

-- CreateIndex
CREATE INDEX "TelemetryEvent_clientId_fleetId_occurredAt_idx" ON "TelemetryEvent"("clientId", "fleetId", "occurredAt");

-- CreateIndex
CREATE INDEX "Battery_clientId_status_idx" ON "Battery"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Battery_clientId_serialNumber_key" ON "Battery"("clientId", "serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Battery_clientId_batteryCode_key" ON "Battery"("clientId", "batteryCode");

-- CreateIndex
CREATE INDEX "FleetBatteryHistory_fleetId_installedAt_idx" ON "FleetBatteryHistory"("fleetId", "installedAt");

-- CreateIndex
CREATE INDEX "FleetBatteryHistory_batteryId_installedAt_idx" ON "FleetBatteryHistory"("batteryId", "installedAt");

-- CreateIndex
CREATE INDEX "FleetBatteryHistory_fleetId_batterySlot_removedAt_idx" ON "FleetBatteryHistory"("fleetId", "batterySlot", "removedAt");

-- CreateIndex
CREATE INDEX "Controller_clientId_status_idx" ON "Controller"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Controller_clientId_controllerNumber_key" ON "Controller"("clientId", "controllerNumber");

-- CreateIndex
CREATE INDEX "FleetControllerHistory_fleetId_installedAt_idx" ON "FleetControllerHistory"("fleetId", "installedAt");

-- CreateIndex
CREATE INDEX "FleetControllerHistory_controllerId_installedAt_idx" ON "FleetControllerHistory"("controllerId", "installedAt");

-- CreateIndex
CREATE INDEX "FleetStatusHistory_fleetId_createdAt_idx" ON "FleetStatusHistory"("fleetId", "createdAt");

-- CreateIndex
CREATE INDEX "FleetTransfer_clientId_fleetId_idx" ON "FleetTransfer"("clientId", "fleetId");

-- CreateIndex
CREATE INDEX "FleetTransfer_clientId_fromHubId_idx" ON "FleetTransfer"("clientId", "fromHubId");

-- CreateIndex
CREATE INDEX "FleetTransfer_clientId_toHubId_idx" ON "FleetTransfer"("clientId", "toHubId");

-- CreateIndex
CREATE INDEX "User_clientId_role_isActive_idx" ON "User"("clientId", "role", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "User_clientId_mobile_key" ON "User"("clientId", "mobile");

-- CreateIndex
CREATE UNIQUE INDEX "User_clientId_id_key" ON "User"("clientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Rider_userId_key" ON "Rider"("userId");

-- CreateIndex
CREATE INDEX "Rider_clientId_status_idx" ON "Rider"("clientId", "status");

-- CreateIndex
CREATE INDEX "Rider_clientId_name_idx" ON "Rider"("clientId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Rider_clientId_mobile_key" ON "Rider"("clientId", "mobile");

-- CreateIndex
CREATE UNIQUE INDEX "Rider_clientId_id_key" ON "Rider"("clientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Rider_clientId_riderCode_key" ON "Rider"("clientId", "riderCode");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMandate_mandateNumber_key" ON "PaymentMandate"("mandateNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMandate_providerMandateId_key" ON "PaymentMandate"("providerMandateId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMandate_providerTokenId_key" ON "PaymentMandate"("providerTokenId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMandate_providerRegistrationId_key" ON "PaymentMandate"("providerRegistrationId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMandate_providerAuthorizationOrderId_key" ON "PaymentMandate"("providerAuthorizationOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMandate_providerAuthorizationPaymentId_key" ON "PaymentMandate"("providerAuthorizationPaymentId");

-- CreateIndex
CREATE INDEX "PaymentMandate_provider_providerCheckedAt_idx" ON "PaymentMandate"("provider", "providerCheckedAt");

-- CreateIndex
CREATE INDEX "PaymentMandate_clientId_riderId_status_idx" ON "PaymentMandate"("clientId", "riderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMandate_clientId_riderId_requestKey_key" ON "PaymentMandate"("clientId", "riderId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMandate_clientId_id_key" ON "PaymentMandate"("clientId", "id");

-- CreateIndex
CREATE INDEX "PaymentMandateEvent_clientId_mandateId_createdAt_idx" ON "PaymentMandateEvent"("clientId", "mandateId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentProviderEvent_clientId_receivedAt_idx" ON "PaymentProviderEvent"("clientId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProviderEvent_provider_eventKey_key" ON "PaymentProviderEvent"("provider", "eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_debitNumber_key" ON "PaymentTransaction"("debitNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_providerOrderId_key" ON "PaymentTransaction"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_gatewayPaymentId_key" ON "PaymentTransaction"("gatewayPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_riderPaymentId_key" ON "PaymentTransaction"("riderPaymentId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_clientId_invoiceId_status_idx" ON "PaymentTransaction"("clientId", "invoiceId", "status");

-- CreateIndex
CREATE INDEX "PaymentTransaction_clientId_riderId_status_idx" ON "PaymentTransaction"("clientId", "riderId", "status");

-- CreateIndex
CREATE INDEX "PaymentTransaction_clientId_mandateId_status_idx" ON "PaymentTransaction"("clientId", "mandateId", "status");

-- CreateIndex
CREATE INDEX "PaymentTransaction_provider_providerCheckedAt_idx" ON "PaymentTransaction"("provider", "providerCheckedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_clientId_id_key" ON "PaymentTransaction"("clientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_clientId_requestKey_key" ON "PaymentTransaction"("clientId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_provider_providerPaymentId_key" ON "PaymentTransaction"("provider", "providerPaymentId");

-- CreateIndex
CREATE INDEX "PaymentAttempt_clientId_status_createdAt_idx" ON "PaymentAttempt"("clientId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_transactionId_sequence_key" ON "PaymentAttempt"("transactionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_collectionRequestId_sequence_key" ON "PaymentAttempt"("collectionRequestId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_clientId_providerPaymentId_key" ON "PaymentAttempt"("clientId", "providerPaymentId");

-- CreateIndex
CREATE INDEX "AutoPayDunningCase_clientId_status_nextRetryAt_idx" ON "AutoPayDunningCase"("clientId", "status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "AutoPayDunningCase_clientId_riderId_status_idx" ON "AutoPayDunningCase"("clientId", "riderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AutoPayDunningCase_clientId_invoiceId_key" ON "AutoPayDunningCase"("clientId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCollectionRequest_paymentNumber_key" ON "PaymentCollectionRequest"("paymentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCollectionRequest_providerOrderId_key" ON "PaymentCollectionRequest"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCollectionRequest_providerPaymentId_key" ON "PaymentCollectionRequest"("providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCollectionRequest_riderPaymentId_key" ON "PaymentCollectionRequest"("riderPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCollectionRequest_depositTransactionId_key" ON "PaymentCollectionRequest"("depositTransactionId");

-- CreateIndex
CREATE INDEX "PaymentCollectionRequest_clientId_riderId_status_idx" ON "PaymentCollectionRequest"("clientId", "riderId", "status");

-- CreateIndex
CREATE INDEX "PaymentCollectionRequest_clientId_invoiceId_status_idx" ON "PaymentCollectionRequest"("clientId", "invoiceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCollectionRequest_clientId_idempotencyKey_key" ON "PaymentCollectionRequest"("clientId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ProviderPaymentObservation_clientId_collectionId_observedAt_idx" ON "ProviderPaymentObservation"("clientId", "collectionId", "observedAt");

-- CreateIndex
CREATE INDEX "ProviderPaymentObservation_clientId_reviewCode_observedAt_idx" ON "ProviderPaymentObservation"("clientId", "reviewCode", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderPaymentObservation_provider_providerPaymentId_key" ON "ProviderPaymentObservation"("provider", "providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "RiderPaymentProfile_riderId_key" ON "RiderPaymentProfile"("riderId");

-- CreateIndex
CREATE INDEX "RiderPaymentProfile_clientId_billingStatus_idx" ON "RiderPaymentProfile"("clientId", "billingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "RiderPaymentProfile_clientId_riderId_key" ON "RiderPaymentProfile"("clientId", "riderId");

-- CreateIndex
CREATE INDEX "RiderCharge_clientId_riderId_status_effectiveAt_idx" ON "RiderCharge"("clientId", "riderId", "status", "effectiveAt");

-- CreateIndex
CREATE INDEX "RiderCharge_clientId_invoiceId_idx" ON "RiderCharge"("clientId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "RiderCharge_clientId_sourceKey_key" ON "RiderCharge"("clientId", "sourceKey");

-- CreateIndex
CREATE INDEX "RiderCredit_clientId_riderId_status_effectiveAt_idx" ON "RiderCredit"("clientId", "riderId", "status", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "RiderCredit_clientId_sourceKey_key" ON "RiderCredit"("clientId", "sourceKey");

-- CreateIndex
CREATE INDEX "RiderLedgerEntry_clientId_riderId_effectiveAt_id_idx" ON "RiderLedgerEntry"("clientId", "riderId", "effectiveAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RiderLedgerEntry_clientId_entryType_sourceType_sourceId_key" ON "RiderLedgerEntry"("clientId", "entryType", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "RiderDeposit_clientId_riderId_status_createdAt_idx" ON "RiderDeposit"("clientId", "riderId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "RiderDeposit_clientId_agreementId_status_idx" ON "RiderDeposit"("clientId", "agreementId", "status");

-- CreateIndex
CREATE INDEX "RiderDeposit_clientId_vehicleId_depositType_idx" ON "RiderDeposit"("clientId", "vehicleId", "depositType");

-- CreateIndex
CREATE UNIQUE INDEX "RiderDeposit_clientId_agreementId_obligationKey_key" ON "RiderDeposit"("clientId", "agreementId", "obligationKey");

-- CreateIndex
CREATE UNIQUE INDEX "RiderDepositTransaction_reversalOfTransactionId_key" ON "RiderDepositTransaction"("reversalOfTransactionId");

-- CreateIndex
CREATE INDEX "RiderDepositTransaction_clientId_depositId_createdAt_idx" ON "RiderDepositTransaction"("clientId", "depositId", "createdAt");

-- CreateIndex
CREATE INDEX "RiderDepositTransaction_clientId_riderId_agreementId_create_idx" ON "RiderDepositTransaction"("clientId", "riderId", "agreementId", "createdAt");

-- CreateIndex
CREATE INDEX "RiderDepositTransaction_clientId_transferReferenceId_idx" ON "RiderDepositTransaction"("clientId", "transferReferenceId");

-- CreateIndex
CREATE UNIQUE INDEX "RiderDepositTransaction_clientId_idempotencyKey_key" ON "RiderDepositTransaction"("clientId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "RiderDepositTransaction_clientId_depositId_externalReferenc_key" ON "RiderDepositTransaction"("clientId", "depositId", "externalReference");

-- CreateIndex
CREATE INDEX "RiderDepositRefundRequest_clientId_depositId_status_idx" ON "RiderDepositRefundRequest"("clientId", "depositId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RiderDepositRefundRequest_clientId_idempotencyKey_key" ON "RiderDepositRefundRequest"("clientId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "RiderInvoice_billingPeriodId_key" ON "RiderInvoice"("billingPeriodId");

-- CreateIndex
CREATE INDEX "RiderInvoice_clientId_riderId_invoiceType_billingPeriodStar_idx" ON "RiderInvoice"("clientId", "riderId", "invoiceType", "billingPeriodStart", "billingPeriodEnd");

-- CreateIndex
CREATE INDEX "RiderInvoice_clientId_riderId_createdAt_idx" ON "RiderInvoice"("clientId", "riderId", "createdAt");

-- CreateIndex
CREATE INDEX "RiderInvoice_clientId_status_dueDate_idx" ON "RiderInvoice"("clientId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "rider_invoice_penalty_notification_idx" ON "RiderInvoice"("invoiceType", "penaltyNotificationQueuedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RiderInvoice_clientId_id_key" ON "RiderInvoice"("clientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RiderInvoice_clientId_invoiceNumber_key" ON "RiderInvoice"("clientId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RiderInvoice_clientId_sourceKey_key" ON "RiderInvoice"("clientId", "sourceKey");

-- CreateIndex
CREATE INDEX "RiderSettlementCreditApplication_clientId_invoiceId_idx" ON "RiderSettlementCreditApplication"("clientId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "RiderSettlementCreditApplication_settlementId_creditId_invo_key" ON "RiderSettlementCreditApplication"("settlementId", "creditId", "invoiceId");

-- CreateIndex
CREATE INDEX "RiderInvoiceLine_clientId_invoiceId_idx" ON "RiderInvoiceLine"("clientId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "RiderInvoiceLine_invoiceId_kind_sourceId_key" ON "RiderInvoiceLine"("invoiceId", "kind", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "RiderBillingSchedule_agreementId_key" ON "RiderBillingSchedule"("agreementId");

-- CreateIndex
CREATE INDEX "RiderBillingSchedule_clientId_status_nextPeriodStart_idx" ON "RiderBillingSchedule"("clientId", "status", "nextPeriodStart");

-- CreateIndex
CREATE INDEX "RiderBillingPeriod_clientId_scheduleId_status_idx" ON "RiderBillingPeriod"("clientId", "scheduleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RiderBillingPeriod_clientId_agreementId_periodStart_periodE_key" ON "RiderBillingPeriod"("clientId", "agreementId", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "RiderTaxProfile_clientId_key" ON "RiderTaxProfile"("clientId");

-- CreateIndex
CREATE INDEX "RiderTaxRule_clientId_chargeType_effectiveFrom_idx" ON "RiderTaxRule"("clientId", "chargeType", "effectiveFrom");

-- CreateIndex
CREATE INDEX "RiderPayment_clientId_riderId_receivedAt_idx" ON "RiderPayment"("clientId", "riderId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RiderPayment_clientId_idempotencyKey_key" ON "RiderPayment"("clientId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "RiderPayment_clientId_id_key" ON "RiderPayment"("clientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RiderPayment_clientId_method_externalReference_key" ON "RiderPayment"("clientId", "method", "externalReference");

-- CreateIndex
CREATE INDEX "RiderPaymentAllocation_clientId_paymentId_idx" ON "RiderPaymentAllocation"("clientId", "paymentId");

-- CreateIndex
CREATE INDEX "RiderPaymentAllocation_clientId_invoiceId_idx" ON "RiderPaymentAllocation"("clientId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRefund_refundNumber_key" ON "PaymentRefund"("refundNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRefund_providerRefundId_key" ON "PaymentRefund"("providerRefundId");

-- CreateIndex
CREATE INDEX "PaymentRefund_clientId_paymentId_status_idx" ON "PaymentRefund"("clientId", "paymentId", "status");

-- CreateIndex
CREATE INDEX "PaymentRefund_clientId_riderId_status_idx" ON "PaymentRefund"("clientId", "riderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRefund_clientId_idempotencyKey_key" ON "PaymentRefund"("clientId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ProviderSettlement_clientId_status_settledAt_idx" ON "ProviderSettlement"("clientId", "status", "settledAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderSettlement_clientId_provider_providerSettlementId_key" ON "ProviderSettlement"("clientId", "provider", "providerSettlementId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderSettlement_clientId_id_key" ON "ProviderSettlement"("clientId", "id");

-- CreateIndex
CREATE INDEX "ProviderSettlementItem_clientId_status_createdAt_idx" ON "ProviderSettlementItem"("clientId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderSettlementItem_settlementId_kind_providerReference_key" ON "ProviderSettlementItem"("settlementId", "kind", "providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "RiderOnboardingProgress_userId_key" ON "RiderOnboardingProgress"("userId");

-- CreateIndex
CREATE INDEX "RiderOnboardingProgress_clientId_packageId_idx" ON "RiderOnboardingProgress"("clientId", "packageId");

-- CreateIndex
CREATE INDEX "UserHub_clientId_hubId_idx" ON "UserHub"("clientId", "hubId");

-- CreateIndex
CREATE INDEX "UserHub_clientId_userId_idx" ON "UserHub"("clientId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserHub_userId_hubId_key" ON "UserHub"("userId", "hubId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamLeaderProfile_userId_key" ON "TeamLeaderProfile"("userId");

-- CreateIndex
CREATE INDEX "TeamLeaderProfile_clientId_deletedAt_idx" ON "TeamLeaderProfile"("clientId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TeamLeaderProfile_clientId_employeeCode_key" ON "TeamLeaderProfile"("clientId", "employeeCode");

-- CreateIndex
CREATE INDEX "TeamLeaderRider_clientId_teamLeaderId_isActive_idx" ON "TeamLeaderRider"("clientId", "teamLeaderId", "isActive");

-- CreateIndex
CREATE INDEX "TeamLeaderRider_clientId_riderId_isActive_idx" ON "TeamLeaderRider"("clientId", "riderId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TeamLeaderRider_teamLeaderId_riderId_key" ON "TeamLeaderRider"("teamLeaderId", "riderId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientOnboardingProgress_clientId_key" ON "ClientOnboardingProgress"("clientId");

-- CreateIndex
CREATE INDEX "ClientOnboardingStepRecord_clientId_step_status_idx" ON "ClientOnboardingStepRecord"("clientId", "step", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClientOnboardingStepRecord_progressId_step_key" ON "ClientOnboardingStepRecord"("progressId", "step");

-- CreateIndex
CREATE INDEX "ImportJob_clientId_entityType_createdAt_idx" ON "ImportJob"("clientId", "entityType", "createdAt");

-- CreateIndex
CREATE INDEX "Allocation_clientId_fleetId_status_idx" ON "Allocation"("clientId", "fleetId", "status");

-- CreateIndex
CREATE INDEX "Allocation_clientId_riderId_status_idx" ON "Allocation"("clientId", "riderId", "status");

-- CreateIndex
CREATE INDEX "Allocation_clientId_commercialOfferId_idx" ON "Allocation"("clientId", "commercialOfferId");

-- CreateIndex
CREATE INDEX "Allocation_clientId_rentalAgreementId_idx" ON "Allocation"("clientId", "rentalAgreementId");

-- CreateIndex
CREATE UNIQUE INDEX "Allocation_clientId_idempotencyKey_key" ON "Allocation"("clientId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Allocation_clientId_id_key" ON "Allocation"("clientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MobileDeploymentWorkflow_allocationId_key" ON "MobileDeploymentWorkflow"("allocationId");

-- CreateIndex
CREATE INDEX "MobileDeploymentWorkflow_clientId_status_idx" ON "MobileDeploymentWorkflow"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentPayment_workflowId_key" ON "DeploymentPayment"("workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentPayment_providerReference_key" ON "DeploymentPayment"("providerReference");

-- CreateIndex
CREATE INDEX "DeploymentPayment_clientId_status_idx" ON "DeploymentPayment"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentPayment_clientId_id_key" ON "DeploymentPayment"("clientId", "id");

-- CreateIndex
CREATE INDEX "Inspection_clientId_status_idx" ON "Inspection"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Inspection_allocationId_type_key" ON "Inspection"("allocationId", "type");

-- CreateIndex
CREATE INDEX "RiderKyc_clientId_status_idx" ON "RiderKyc"("clientId", "status");

-- CreateIndex
CREATE INDEX "RiderKyc_provider_providerReference_idx" ON "RiderKyc"("provider", "providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "RiderKyc_riderId_type_key" ON "RiderKyc"("riderId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "KycProviderConfig_code_key" ON "KycProviderConfig"("code");

-- CreateIndex
CREATE UNIQUE INDEX "KycProviderCapability_providerId_verificationType_key" ON "KycProviderCapability"("providerId", "verificationType");

-- CreateIndex
CREATE INDEX "KycProviderCredential_providerId_clientId_environment_idx" ON "KycProviderCredential"("providerId", "clientId", "environment");

-- CreateIndex
CREATE INDEX "KycConsent_clientId_riderId_verificationType_acceptedAt_idx" ON "KycConsent"("clientId", "riderId", "verificationType", "acceptedAt");

-- CreateIndex
CREATE INDEX "KycVerification_clientId_riderId_verificationType_idx" ON "KycVerification"("clientId", "riderId", "verificationType");

-- CreateIndex
CREATE INDEX "KycVerification_clientId_verificationType_status_idx" ON "KycVerification"("clientId", "verificationType", "status");

-- CreateIndex
CREATE INDEX "KycVerification_clientId_status_createdAt_idx" ON "KycVerification"("clientId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "KycVerification_verificationType_status_createdAt_idx" ON "KycVerification"("verificationType", "status", "createdAt");

-- CreateIndex
CREATE INDEX "KycVerification_createdAt_idx" ON "KycVerification"("createdAt");

-- CreateIndex
CREATE INDEX "KycVerification_clientId_requestedAt_verificationType_idx" ON "KycVerification"("clientId", "requestedAt", "verificationType");

-- CreateIndex
CREATE UNIQUE INDEX "KycVerification_clientId_idempotencyKey_key" ON "KycVerification"("clientId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "KycRecoveryRequest_verificationId_createdAt_idx" ON "KycRecoveryRequest"("verificationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "KycRecoveryRequest_clientId_keyHash_key" ON "KycRecoveryRequest"("clientId", "keyHash");

-- CreateIndex
CREATE INDEX "KycClientPolicy_clientId_verificationType_status_effectiveF_idx" ON "KycClientPolicy"("clientId", "verificationType", "status", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureUsageConsumption_verificationId_key" ON "FeatureUsageConsumption"("verificationId");

-- CreateIndex
CREATE INDEX "FeatureUsageConsumption_clientId_featureId_occurredAt_idx" ON "FeatureUsageConsumption"("clientId", "featureId", "occurredAt");

-- CreateIndex
CREATE INDEX "FeatureUsageConsumption_subscriptionId_occurredAt_idx" ON "FeatureUsageConsumption"("subscriptionId", "occurredAt");

-- CreateIndex
CREATE INDEX "FeatureUsageConsumption_clientId_occurredAt_idx" ON "FeatureUsageConsumption"("clientId", "occurredAt");

-- CreateIndex
CREATE INDEX "KycVerificationAttempt_providerId_requestStartedAt_idx" ON "KycVerificationAttempt"("providerId", "requestStartedAt");

-- CreateIndex
CREATE INDEX "KycVerificationAttempt_verificationId_reason_requestStarted_idx" ON "KycVerificationAttempt"("verificationId", "reason", "requestStartedAt");

-- CreateIndex
CREATE INDEX "KycVerificationAttempt_requestStartedAt_providerId_idx" ON "KycVerificationAttempt"("requestStartedAt", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "KycVerificationAttempt_verificationId_attemptNumber_key" ON "KycVerificationAttempt"("verificationId", "attemptNumber");

-- CreateIndex
CREATE INDEX "KycProviderSlaPolicy_providerId_verificationType_effectiveF_idx" ON "KycProviderSlaPolicy"("providerId", "verificationType", "effectiveFrom", "effectiveUntil");

-- CreateIndex
CREATE INDEX "KycRoutingPolicy_clientId_verificationType_status_isDefault_idx" ON "KycRoutingPolicy"("clientId", "verificationType", "status", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "KycRoutingPolicy_code_version_clientId_key" ON "KycRoutingPolicy"("code", "version", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "KycRoutingProvider_routingPolicyId_providerId_key" ON "KycRoutingProvider"("routingPolicyId", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "KycRoutingProvider_routingPolicyId_priority_key" ON "KycRoutingProvider"("routingPolicyId", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "KycRoutingDecision_verificationId_key" ON "KycRoutingDecision"("verificationId");

-- CreateIndex
CREATE INDEX "KycRoutingDecision_routingPolicyId_createdAt_idx" ON "KycRoutingDecision"("routingPolicyId", "createdAt");

-- CreateIndex
CREATE INDEX "KycIntelligentRoutingPolicy_clientId_verificationType_envir_idx" ON "KycIntelligentRoutingPolicy"("clientId", "verificationType", "environment", "status", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "KycIntelligentRoutingPolicy_code_version_clientId_key" ON "KycIntelligentRoutingPolicy"("code", "version", "clientId");

-- CreateIndex
CREATE INDEX "KycRoutingMetricSnapshot_verificationType_windowMinutes_gen_idx" ON "KycRoutingMetricSnapshot"("verificationType", "windowMinutes", "generatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "KycRoutingMetricSnapshot_providerId_verificationType_window_key" ON "KycRoutingMetricSnapshot"("providerId", "verificationType", "windowMinutes");

-- CreateIndex
CREATE INDEX "KycProviderCircuitState_state_openUntil_idx" ON "KycProviderCircuitState"("state", "openUntil");

-- CreateIndex
CREATE UNIQUE INDEX "KycProviderCircuitState_providerId_verificationType_key" ON "KycProviderCircuitState"("providerId", "verificationType");

-- CreateIndex
CREATE UNIQUE INDEX "KycShadowDecision_verificationId_key" ON "KycShadowDecision"("verificationId");

-- CreateIndex
CREATE INDEX "KycShadowDecision_policyId_createdAt_idx" ON "KycShadowDecision"("policyId", "createdAt");

-- CreateIndex
CREATE INDEX "KycShadowDecision_clientId_createdAt_idx" ON "KycShadowDecision"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "KycProviderConflict_verificationId_conflictType_idx" ON "KycProviderConflict"("verificationId", "conflictType");

-- CreateIndex
CREATE UNIQUE INDEX "KycProviderConflict_verificationId_providerId_key" ON "KycProviderConflict"("verificationId", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "KycVerificationResult_attemptId_key" ON "KycVerificationResult"("attemptId");

-- CreateIndex
CREATE INDEX "KycVerificationResult_verificationId_createdAt_idx" ON "KycVerificationResult"("verificationId", "createdAt");

-- CreateIndex
CREATE INDEX "KycWorkflowDefinition_clientId_isDefault_status_idx" ON "KycWorkflowDefinition"("clientId", "isDefault", "status");

-- CreateIndex
CREATE UNIQUE INDEX "KycWorkflowDefinition_code_version_clientId_key" ON "KycWorkflowDefinition"("code", "version", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "KycWorkflowStep_workflowDefinitionId_code_key" ON "KycWorkflowStep"("workflowDefinitionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "KycWorkflowStep_workflowDefinitionId_sequence_key" ON "KycWorkflowStep"("workflowDefinitionId", "sequence");

-- CreateIndex
CREATE INDEX "KycWorkflowExecution_clientId_riderId_startedAt_idx" ON "KycWorkflowExecution"("clientId", "riderId", "startedAt");

-- CreateIndex
CREATE INDEX "KycWorkflowExecution_clientId_status_expiresAt_idx" ON "KycWorkflowExecution"("clientId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "KycWorkflowExecution_clientId_status_updatedAt_idx" ON "KycWorkflowExecution"("clientId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "KycWorkflowExecution_clientId_status_reviewPriority_reviewD_idx" ON "KycWorkflowExecution"("clientId", "status", "reviewPriority", "reviewDueAt");

-- CreateIndex
CREATE INDEX "KycWorkflowExecution_reviewAssignedTo_status_reviewDueAt_idx" ON "KycWorkflowExecution"("reviewAssignedTo", "status", "reviewDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "KycWorkflowExecution_clientId_idempotencyKey_key" ON "KycWorkflowExecution"("clientId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "KycOperationalAlert_dedupeKey_key" ON "KycOperationalAlert"("dedupeKey");

-- CreateIndex
CREATE INDEX "KycOperationalAlert_clientId_status_lastSeenAt_idx" ON "KycOperationalAlert"("clientId", "status", "lastSeenAt");

-- CreateIndex
CREATE INDEX "KycOperationalAlert_type_status_lastSeenAt_idx" ON "KycOperationalAlert"("type", "status", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "KycWorkflowStepExecution_verificationId_key" ON "KycWorkflowStepExecution"("verificationId");

-- CreateIndex
CREATE INDEX "KycWorkflowStepExecution_workflowExecutionId_status_idx" ON "KycWorkflowStepExecution"("workflowExecutionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "KycWorkflowStepExecution_workflowExecutionId_workflowStepId_key" ON "KycWorkflowStepExecution"("workflowExecutionId", "workflowStepId");

-- CreateIndex
CREATE INDEX "KycDecisionRule_workflowDefinitionId_isActive_priority_idx" ON "KycDecisionRule"("workflowDefinitionId", "isActive", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "KycDecisionRule_code_workflowDefinitionId_key" ON "KycDecisionRule"("code", "workflowDefinitionId");

-- CreateIndex
CREATE INDEX "KycDecision_workflowExecutionId_decidedAt_idx" ON "KycDecision"("workflowExecutionId", "decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "KycReconciliationResult_workflowExecutionId_type_key" ON "KycReconciliationResult"("workflowExecutionId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Photo_objectKey_key" ON "Photo"("objectKey");

-- CreateIndex
CREATE INDEX "Photo_clientId_workFlowType_subjectType_entityId_idx" ON "Photo"("clientId", "workFlowType", "subjectType", "entityId");

-- CreateIndex
CREATE INDEX "Photo_clientId_status_idx" ON "Photo"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RiderOnboardingDocument_photoId_key" ON "RiderOnboardingDocument"("photoId");

-- CreateIndex
CREATE INDEX "RiderOnboardingDocument_clientId_userId_fieldCode_status_idx" ON "RiderOnboardingDocument"("clientId", "userId", "fieldCode", "status");

-- CreateIndex
CREATE INDEX "RiderOnboardingDocument_clientId_riderId_status_idx" ON "RiderOnboardingDocument"("clientId", "riderId", "status");

-- CreateIndex
CREATE INDEX "RiderOnboardingDocument_clientId_status_createdAt_idx" ON "RiderOnboardingDocument"("clientId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PhotoRequirement_clientId_workFlowType_subjectType_sortOrde_idx" ON "PhotoRequirement"("clientId", "workFlowType", "subjectType", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoRequirement_clientId_workFlowType_subjectType_photoTyp_key" ON "PhotoRequirement"("clientId", "workFlowType", "subjectType", "photoType");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "AttendancePeriod_userId_checkInAt_idx" ON "AttendancePeriod"("userId", "checkInAt");

-- CreateIndex
CREATE INDEX "AttendancePeriod_clientId_checkInAt_idx" ON "AttendancePeriod"("clientId", "checkInAt");

-- CreateIndex
CREATE INDEX "AuditLog_clientId_entityType_entityId_createdAt_idx" ON "AuditLog"("clientId", "entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_clientId_action_createdAt_idx" ON "AuditLog"("clientId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "OtpRequest_phone_purpose_createdAt_idx" ON "OtpRequest"("phone", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "OtpRequest_clientId_status_idx" ON "OtpRequest"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClientDomain_hostname_key" ON "ClientDomain"("hostname");

-- CreateIndex
CREATE INDEX "ClientDomain_clientId_idx" ON "ClientDomain"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientBranding_clientId_key" ON "ClientBranding"("clientId");

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
CREATE UNIQUE INDEX "RoutingProviderUsage_provider_billingMonth_key" ON "RoutingProviderUsage"("provider", "billingMonth");

-- CreateIndex
CREATE INDEX "RiderRateCard_clientId_status_priority_idx" ON "RiderRateCard"("clientId", "status", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "RiderRateCard_clientId_code_key" ON "RiderRateCard"("clientId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "RiderRateCard_clientId_id_key" ON "RiderRateCard"("clientId", "id");

-- CreateIndex
CREATE INDEX "RiderRateCardVersion_clientId_rateCardId_status_effectiveFr_idx" ON "RiderRateCardVersion"("clientId", "rateCardId", "status", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "RiderRateCardVersion_clientId_rateCardId_version_key" ON "RiderRateCardVersion"("clientId", "rateCardId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RiderRateCardVersion_clientId_id_key" ON "RiderRateCardVersion"("clientId", "id");

-- CreateIndex
CREATE INDEX "RateCardRentalRate_clientId_rateCardVersionId_rentalPeriodT_idx" ON "RateCardRentalRate"("clientId", "rateCardVersionId", "rentalPeriodType", "isActive");

-- CreateIndex
CREATE INDEX "RateCardRentalRate_vehicleCategoryId_vehicleTypeId_oemId_mo_idx" ON "RateCardRentalRate"("vehicleCategoryId", "vehicleTypeId", "oemId", "modelName", "variantName", "fleetId");

-- CreateIndex
CREATE INDEX "RateCardFee_clientId_rateCardVersionId_nature_isActive_idx" ON "RateCardFee"("clientId", "rateCardVersionId", "nature", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "RateCardFee_clientId_rateCardVersionId_code_key" ON "RateCardFee"("clientId", "rateCardVersionId", "code");

-- CreateIndex
CREATE INDEX "RateCardDeposit_clientId_rateCardVersionId_depositType_isAc_idx" ON "RateCardDeposit"("clientId", "rateCardVersionId", "depositType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "RateCardDeposit_clientId_rateCardVersionId_code_key" ON "RateCardDeposit"("clientId", "rateCardVersionId", "code");

-- CreateIndex
CREATE INDEX "RateCardAdjustment_clientId_rateCardVersionId_adjustmentTyp_idx" ON "RateCardAdjustment"("clientId", "rateCardVersionId", "adjustmentType", "isActive");

-- CreateIndex
CREATE INDEX "RateCardAdjustment_city_hubId_fleetId_rentalPeriodType_idx" ON "RateCardAdjustment"("city", "hubId", "fleetId", "rentalPeriodType");

-- CreateIndex
CREATE UNIQUE INDEX "RateCardAdjustment_clientId_rateCardVersionId_code_key" ON "RateCardAdjustment"("clientId", "rateCardVersionId", "code");

-- CreateIndex
CREATE INDEX "RiderBatteryPlan_clientId_isActive_pricingType_idx" ON "RiderBatteryPlan"("clientId", "isActive", "pricingType");

-- CreateIndex
CREATE UNIQUE INDEX "RiderBatteryPlan_clientId_code_key" ON "RiderBatteryPlan"("clientId", "code");

-- CreateIndex
CREATE INDEX "VehicleCommercialGradeAssignment_clientId_fleetId_effective_idx" ON "VehicleCommercialGradeAssignment"("clientId", "fleetId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "RiderPromotion_clientId_isActive_validFrom_validTo_idx" ON "RiderPromotion"("clientId", "isActive", "validFrom", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "RiderPromotion_clientId_code_key" ON "RiderPromotion"("clientId", "code");

-- CreateIndex
CREATE INDEX "RiderCommercialTerms_clientId_code_status_idx" ON "RiderCommercialTerms"("clientId", "code", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RiderCommercialTerms_clientId_code_version_key" ON "RiderCommercialTerms"("clientId", "code", "version");

-- CreateIndex
CREATE INDEX "AppLegalDocument_clientId_appCode_role_kind_locale_effectiv_idx" ON "AppLegalDocument"("clientId", "appCode", "role", "kind", "locale", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "AppLegalDocument_clientId_appCode_role_kind_locale_version_key" ON "AppLegalDocument"("clientId", "appCode", "role", "kind", "locale", "version");

-- CreateIndex
CREATE INDEX "AppLegalTemplate_isActive_deletedAt_idx" ON "AppLegalTemplate"("isActive", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AppLegalTemplate_appCode_role_kind_locale_version_key" ON "AppLegalTemplate"("appCode", "role", "kind", "locale", "version");

-- CreateIndex
CREATE INDEX "AppLegalAcceptance_clientId_userId_acceptedAt_idx" ON "AppLegalAcceptance"("clientId", "userId", "acceptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AppLegalAcceptance_userId_documentId_key" ON "AppLegalAcceptance"("userId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "RiderCommercialOffer_offerNumber_key" ON "RiderCommercialOffer"("offerNumber");

-- CreateIndex
CREATE INDEX "RiderCommercialOffer_clientId_riderId_status_createdAt_idx" ON "RiderCommercialOffer"("clientId", "riderId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "RiderCommercialOffer_clientId_vehicleId_status_expiresAt_idx" ON "RiderCommercialOffer"("clientId", "vehicleId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "RiderCommercialOffer_clientId_rateCardVersionId_idx" ON "RiderCommercialOffer"("clientId", "rateCardVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "RiderCommercialOffer_clientId_idempotencyKey_key" ON "RiderCommercialOffer"("clientId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "RiderCommercialOffer_clientId_id_key" ON "RiderCommercialOffer"("clientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RiderRentalAgreement_agreementNumber_key" ON "RiderRentalAgreement"("agreementNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RiderRentalAgreement_commercialOfferId_key" ON "RiderRentalAgreement"("commercialOfferId");

-- CreateIndex
CREATE INDEX "RiderRentalAgreement_clientId_riderId_status_createdAt_idx" ON "RiderRentalAgreement"("clientId", "riderId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "RiderRentalAgreement_clientId_vehicleId_status_idx" ON "RiderRentalAgreement"("clientId", "vehicleId", "status");

-- CreateIndex
CREATE INDEX "RiderRentalAgreement_clientId_startDate_endDate_idx" ON "RiderRentalAgreement"("clientId", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "RiderRentalAgreement_clientId_id_key" ON "RiderRentalAgreement"("clientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RentalTerminationRequest_agreementId_key" ON "RentalTerminationRequest"("agreementId");

-- CreateIndex
CREATE UNIQUE INDEX "RentalTerminationRequest_allocationId_key" ON "RentalTerminationRequest"("allocationId");

-- CreateIndex
CREATE INDEX "RentalTerminationRequest_clientId_riderId_status_idx" ON "RentalTerminationRequest"("clientId", "riderId", "status");

-- CreateIndex
CREATE INDEX "RentalTerminationRequest_clientId_plannedHubId_status_idx" ON "RentalTerminationRequest"("clientId", "plannedHubId", "status");

-- CreateIndex
CREATE INDEX "RentalTerminationRequest_clientId_receivedHubId_status_idx" ON "RentalTerminationRequest"("clientId", "receivedHubId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RentalTerminationRequest_clientId_idempotencyKey_key" ON "RentalTerminationRequest"("clientId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "RentalTerminationRequest_clientId_agreementId_key" ON "RentalTerminationRequest"("clientId", "agreementId");

-- CreateIndex
CREATE INDEX "ReturnPenaltyPrice_clientId_isActive_idx" ON "ReturnPenaltyPrice"("clientId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnPenaltyPrice_clientId_masterSpareId_key" ON "ReturnPenaltyPrice"("clientId", "masterSpareId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnPenaltyPrice_clientId_code_key" ON "ReturnPenaltyPrice"("clientId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnPenaltyCase_terminationRequestId_key" ON "ReturnPenaltyCase"("terminationRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnPenaltyCase_inspectionId_key" ON "ReturnPenaltyCase"("inspectionId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnPenaltyCase_postedChargeId_key" ON "ReturnPenaltyCase"("postedChargeId");

-- CreateIndex
CREATE INDEX "ReturnPenaltyCase_clientId_riderId_status_updatedAt_idx" ON "ReturnPenaltyCase"("clientId", "riderId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "ReturnPenaltyCase_clientId_status_updatedAt_idx" ON "ReturnPenaltyCase"("clientId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnPenaltyCase_clientId_id_key" ON "ReturnPenaltyCase"("clientId", "id");

-- CreateIndex
CREATE INDEX "ReturnPenaltyItem_clientId_caseId_revision_idx" ON "ReturnPenaltyItem"("clientId", "caseId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnPenaltyItem_caseId_revision_position_key" ON "ReturnPenaltyItem"("caseId", "revision", "position");

-- CreateIndex
CREATE INDEX "SupportTicket_clientId_riderId_lastActivityAt_id_idx" ON "SupportTicket"("clientId", "riderId", "lastActivityAt", "id");

-- CreateIndex
CREATE INDEX "SupportTicket_clientId_hubId_lastActivityAt_id_idx" ON "SupportTicket"("clientId", "hubId", "lastActivityAt", "id");

-- CreateIndex
CREATE INDEX "SupportTicket_clientId_status_lastActivityAt_id_idx" ON "SupportTicket"("clientId", "status", "lastActivityAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_clientId_id_key" ON "SupportTicket"("clientId", "id");

-- CreateIndex
CREATE INDEX "SupportReply_clientId_ticketId_createdAt_id_idx" ON "SupportReply"("clientId", "ticketId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RiderFinalSettlement_agreementId_key" ON "RiderFinalSettlement"("agreementId");

-- CreateIndex
CREATE INDEX "RiderFinalSettlement_clientId_riderId_status_idx" ON "RiderFinalSettlement"("clientId", "riderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RiderFinalSettlement_clientId_id_key" ON "RiderFinalSettlement"("clientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RiderFinalSettlement_clientId_agreementId_key" ON "RiderFinalSettlement"("clientId", "agreementId");

-- CreateIndex
CREATE UNIQUE INDEX "RiderFinalSettlement_clientId_settlementNumber_key" ON "RiderFinalSettlement"("clientId", "settlementNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementRevision_settlementId_version_key" ON "SettlementRevision"("settlementId", "version");

-- CreateIndex
CREATE INDEX "SettlementChargeAssessment_clientId_settlementId_status_idx" ON "SettlementChargeAssessment"("clientId", "settlementId", "status");

-- CreateIndex
CREATE INDEX "SettlementDepositHold_clientId_depositId_status_idx" ON "SettlementDepositHold"("clientId", "depositId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementDepositApplication_depositTransactionId_key" ON "SettlementDepositApplication"("depositTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementDepositApplication_paymentId_key" ON "SettlementDepositApplication"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementDepositApplication_settlementId_depositId_key" ON "SettlementDepositApplication"("settlementId", "depositId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementRefundRequest_depositRefundId_key" ON "SettlementRefundRequest"("depositRefundId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementRefundRequest_paymentRefundId_key" ON "SettlementRefundRequest"("paymentRefundId");

-- CreateIndex
CREATE INDEX "SettlementRefundRequest_clientId_settlementId_status_idx" ON "SettlementRefundRequest"("clientId", "settlementId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementRefundRequest_clientId_idempotencyKey_key" ON "SettlementRefundRequest"("clientId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "SettlementAdjustment_clientId_settlementId_status_idx" ON "SettlementAdjustment"("clientId", "settlementId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RiderFinancialNote_sourceId_key" ON "RiderFinancialNote"("sourceId");

-- CreateIndex
CREATE INDEX "RiderFinancialNote_clientId_riderId_issuedAt_idx" ON "RiderFinancialNote"("clientId", "riderId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RiderFinancialNote_clientId_noteNumber_key" ON "RiderFinancialNote"("clientId", "noteNumber");

-- CreateIndex
CREATE INDEX "RiderRentalAgreementStatusHistory_clientId_agreementId_chan_idx" ON "RiderRentalAgreementStatusHistory"("clientId", "agreementId", "changedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RiderRentalAgreementAmendment_exchangeRequestId_key" ON "RiderRentalAgreementAmendment"("exchangeRequestId");

-- CreateIndex
CREATE INDEX "RiderRentalAgreementAmendment_clientId_agreementId_status_idx" ON "RiderRentalAgreementAmendment"("clientId", "agreementId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RiderRentalAgreementAmendment_agreementId_amendmentNumber_key" ON "RiderRentalAgreementAmendment"("agreementId", "amendmentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RiderAgreementCommercialVersion_amendmentId_key" ON "RiderAgreementCommercialVersion"("amendmentId");

-- CreateIndex
CREATE INDEX "RiderAgreementCommercialVersion_clientId_agreementId_effect_idx" ON "RiderAgreementCommercialVersion"("clientId", "agreementId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "RiderAgreementCommercialVersion_agreementId_versionNumber_key" ON "RiderAgreementCommercialVersion"("agreementId", "versionNumber");

-- CreateIndex
CREATE INDEX "VehicleExchangeRequest_clientId_agreementId_status_idx" ON "VehicleExchangeRequest"("clientId", "agreementId", "status");

-- CreateIndex
CREATE INDEX "VehicleExchangeRequest_clientId_replacementVehicleId_status_idx" ON "VehicleExchangeRequest"("clientId", "replacementVehicleId", "status");

-- CreateIndex
CREATE INDEX "VehicleExchangeOffer_clientId_exchangeRequestId_status_idx" ON "VehicleExchangeOffer"("clientId", "exchangeRequestId", "status");

-- CreateIndex
CREATE INDEX "CollectionPolicy_clientId_status_idx" ON "CollectionPolicy"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionPolicy_clientId_code_key" ON "CollectionPolicy"("clientId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionPolicy_clientId_id_key" ON "CollectionPolicy"("clientId", "id");

-- CreateIndex
CREATE INDEX "CollectionPolicyVersion_clientId_effectiveFrom_effectiveTo_idx" ON "CollectionPolicyVersion"("clientId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionPolicyVersion_policyId_version_key" ON "CollectionPolicyVersion"("policyId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionPolicyVersion_clientId_id_key" ON "CollectionPolicyVersion"("clientId", "id");

-- CreateIndex
CREATE INDEX "CollectionPolicyStage_policyVersionId_daysFromDue_idx" ON "CollectionPolicyStage"("policyVersionId", "daysFromDue");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionPolicyStage_policyVersionId_stageCode_key" ON "CollectionPolicyStage"("policyVersionId", "stageCode");

-- CreateIndex
CREATE UNIQUE INDEX "RiderCollectionCase_caseNumber_key" ON "RiderCollectionCase"("caseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RiderCollectionCase_activeRiderId_key" ON "RiderCollectionCase"("activeRiderId");

-- CreateIndex
CREATE INDEX "RiderCollectionCase_clientId_riderId_status_idx" ON "RiderCollectionCase"("clientId", "riderId", "status");

-- CreateIndex
CREATE INDEX "RiderCollectionCase_clientId_status_daysPastDue_idx" ON "RiderCollectionCase"("clientId", "status", "daysPastDue");

-- CreateIndex
CREATE INDEX "RiderCollectionCase_clientId_assignedToId_status_idx" ON "RiderCollectionCase"("clientId", "assignedToId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RiderCollectionCase_clientId_id_key" ON "RiderCollectionCase"("clientId", "id");

-- CreateIndex
CREATE INDEX "CollectionCaseInvoice_clientId_invoiceId_idx" ON "CollectionCaseInvoice"("clientId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionCaseInvoice_caseId_invoiceId_key" ON "CollectionCaseInvoice"("caseId", "invoiceId");

-- CreateIndex
CREATE INDEX "CollectionAction_clientId_status_scheduledAt_idx" ON "CollectionAction"("clientId", "status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionAction_clientId_idempotencyKey_key" ON "CollectionAction"("clientId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PromiseToPay_activeCaseId_key" ON "PromiseToPay"("activeCaseId");

-- CreateIndex
CREATE INDEX "PromiseToPay_clientId_riderId_status_idx" ON "PromiseToPay"("clientId", "riderId", "status");

-- CreateIndex
CREATE INDEX "CollectionCaseNote_clientId_caseId_createdAt_idx" ON "CollectionCaseNote"("clientId", "caseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionTask_idempotencyKey_key" ON "CollectionTask"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CollectionTask_clientId_status_dueAt_idx" ON "CollectionTask"("clientId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "CollectionWaiver_clientId_caseId_status_idx" ON "CollectionWaiver"("clientId", "caseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LateFeePolicy_clientId_key" ON "LateFeePolicy"("clientId");

-- CreateIndex
CREATE INDEX "CollectionDispute_clientId_caseId_status_idx" ON "CollectionDispute"("clientId", "caseId", "status");

-- CreateIndex
CREATE INDEX "CommercialRestriction_clientId_riderId_status_code_idx" ON "CommercialRestriction"("clientId", "riderId", "status", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialRestriction_caseId_code_key" ON "CommercialRestriction"("caseId", "code");

-- CreateIndex
CREATE INDEX "CollectionEvent_clientId_caseId_createdAt_idx" ON "CollectionEvent"("clientId", "caseId", "createdAt");

-- CreateIndex
CREATE INDEX "CollectionEvaluationQueue_requestedAt_idx" ON "CollectionEvaluationQueue"("requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionEvaluationQueue_clientId_riderId_key" ON "CollectionEvaluationQueue"("clientId", "riderId");

-- CreateIndex
CREATE UNIQUE INDEX "RiderWallet_clientId_riderId_currency_key" ON "RiderWallet"("clientId", "riderId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "RiderWallet_clientId_id_key" ON "RiderWallet"("clientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RiderWallet_clientId_riderId_id_key" ON "RiderWallet"("clientId", "riderId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WalletAccount_clientId_walletId_accountType_key" ON "WalletAccount"("clientId", "walletId", "accountType");

-- CreateIndex
CREATE UNIQUE INDEX "WalletAccount_clientId_walletId_id_key" ON "WalletAccount"("clientId", "walletId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_transactionNumber_key" ON "WalletTransaction"("transactionNumber");

-- CreateIndex
CREATE INDEX "WalletTransaction_clientId_walletId_createdAt_idx" ON "WalletTransaction"("clientId", "walletId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_clientId_idempotencyKey_key" ON "WalletTransaction"("clientId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_clientId_id_key" ON "WalletTransaction"("clientId", "id");

-- CreateIndex
CREATE INDEX "WalletLedgerEntry_clientId_accountId_createdAt_idx" ON "WalletLedgerEntry"("clientId", "accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletLedgerEntry_transactionId_sequence_key" ON "WalletLedgerEntry"("transactionId", "sequence");

-- CreateIndex
CREATE INDEX "WalletHold_clientId_walletId_status_idx" ON "WalletHold"("clientId", "walletId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WalletHold_clientId_idempotencyKey_key" ON "WalletHold"("clientId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "WalletPolicy_clientId_effectiveFrom_idx" ON "WalletPolicy"("clientId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "WalletPolicy_clientId_version_key" ON "WalletPolicy"("clientId", "version");

-- CreateIndex
CREATE INDEX "WalletSecurityDeposit_clientId_walletId_status_idx" ON "WalletSecurityDeposit"("clientId", "walletId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WalletSecurityDeposit_clientId_riderId_sourceType_sourceId_key" ON "WalletSecurityDeposit"("clientId", "riderId", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletSecurityDeposit_clientId_id_key" ON "WalletSecurityDeposit"("clientId", "id");

-- CreateIndex
CREATE INDEX "WalletDepositRefundRequest_clientId_depositId_status_idx" ON "WalletDepositRefundRequest"("clientId", "depositId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WalletDepositRefundRequest_clientId_idempotencyKey_key" ON "WalletDepositRefundRequest"("clientId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "WalletDepositRefundRequest_clientId_externalReference_key" ON "WalletDepositRefundRequest"("clientId", "externalReference");

-- CreateIndex
CREATE INDEX "WalletInvoiceAllocation_clientId_invoiceId_createdAt_idx" ON "WalletInvoiceAllocation"("clientId", "invoiceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletInvoiceAllocation_transactionId_sourceType_key" ON "WalletInvoiceAllocation"("transactionId", "sourceType");

-- CreateIndex
CREATE UNIQUE INDEX "WalletInvoiceAllocation_reversalOfId_key" ON "WalletInvoiceAllocation"("reversalOfId");

-- CreateIndex
CREATE INDEX "RewardProgram_clientId_status_validFrom_validUntil_idx" ON "RewardProgram"("clientId", "status", "validFrom", "validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "RewardProgram_clientId_code_key" ON "RewardProgram"("clientId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "RewardProgram_clientId_id_key" ON "RewardProgram"("clientId", "id");

-- CreateIndex
CREATE INDEX "RewardRule_clientId_triggerType_isActive_idx" ON "RewardRule"("clientId", "triggerType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "RewardRule_clientId_programId_code_key" ON "RewardRule"("clientId", "programId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "RewardRule_clientId_id_key" ON "RewardRule"("clientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RewardClaim_walletTransactionId_key" ON "RewardClaim"("walletTransactionId");

-- CreateIndex
CREATE INDEX "RewardClaim_clientId_riderId_createdAt_idx" ON "RewardClaim"("clientId", "riderId", "createdAt");

-- CreateIndex
CREATE INDEX "RewardClaim_clientId_status_createdAt_idx" ON "RewardClaim"("clientId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "RewardClaim_clientId_programId_status_idx" ON "RewardClaim"("clientId", "programId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RewardClaim_clientId_ruleId_sourceType_sourceId_riderId_key" ON "RewardClaim"("clientId", "ruleId", "sourceType", "sourceId", "riderId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardClaim_clientId_sourceType_sourceId_key" ON "RewardClaim"("clientId", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardClaim_clientId_id_key" ON "RewardClaim"("clientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RewardLot_claimId_key" ON "RewardLot"("claimId");

-- CreateIndex
CREATE INDEX "RewardLot_clientId_riderId_status_expiresAt_idx" ON "RewardLot"("clientId", "riderId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RewardLot_clientId_id_key" ON "RewardLot"("clientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RewardLot_clientId_claimId_key" ON "RewardLot"("clientId", "claimId");

-- CreateIndex
CREATE INDEX "RewardLotConsumption_clientId_transactionId_idx" ON "RewardLotConsumption"("clientId", "transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardLotConsumption_lotId_transactionId_key" ON "RewardLotConsumption"("lotId", "transactionId");

-- CreateIndex
CREATE INDEX "RewardEvent_clientId_claimId_createdAt_idx" ON "RewardEvent"("clientId", "claimId", "createdAt");

-- CreateIndex
CREATE INDEX "RiderReferenceReview_clientId_ownerKey_idx" ON "RiderReferenceReview"("clientId", "ownerKey");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleSubmission_allocationId_key" ON "VehicleSubmission"("allocationId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleSubmission_inspectionId_key" ON "VehicleSubmission"("inspectionId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleSubmission_returnRequestId_key" ON "VehicleSubmission"("returnRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleSubmission_exchangeRequestId_key" ON "VehicleSubmission"("exchangeRequestId");

-- CreateIndex
CREATE INDEX "VehicleSubmission_clientId_riderId_createdAt_idx" ON "VehicleSubmission"("clientId", "riderId", "createdAt");

-- CreateIndex
CREATE INDEX "VehicleSubmission_clientId_hubId_status_idx" ON "VehicleSubmission"("clientId", "hubId", "status");

-- CreateIndex
CREATE INDEX "VehicleSubmission_clientId_agreementId_idx" ON "VehicleSubmission"("clientId", "agreementId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleSubmissionReport_postedChargeId_key" ON "VehicleSubmissionReport"("postedChargeId");

-- CreateIndex
CREATE INDEX "VehicleSubmissionReport_clientId_submissionId_createdAt_idx" ON "VehicleSubmissionReport"("clientId", "submissionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleSubmissionReport_clientId_submissionId_requestKey_key" ON "VehicleSubmissionReport"("clientId", "submissionId", "requestKey");

-- CreateIndex
CREATE INDEX "PushDevice_clientId_userId_isActive_idx" ON "PushDevice"("clientId", "userId", "isActive");

-- CreateIndex
CREATE INDEX "PushDevice_sessionId_idx" ON "PushDevice"("sessionId");

-- CreateIndex
CREATE INDEX "PushDevice_tokenHash_idx" ON "PushDevice"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "PushDevice_installationId_appCode_key" ON "PushDevice"("installationId", "appCode");

-- CreateIndex
CREATE INDEX "NotificationMessage_clientId_createdAt_id_idx" ON "NotificationMessage"("clientId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "NotificationMessage_status_createdAt_idx" ON "NotificationMessage"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationMessage_clientId_requestKey_key" ON "NotificationMessage"("clientId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationMessage_clientId_id_key" ON "NotificationMessage"("clientId", "id");

-- CreateIndex
CREATE INDEX "UserNotification_clientId_userId_createdAt_id_idx" ON "UserNotification"("clientId", "userId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "UserNotification_clientId_userId_readAt_idx" ON "UserNotification"("clientId", "userId", "readAt");

-- CreateIndex
CREATE INDEX "UserNotification_expandedAt_createdAt_idx" ON "UserNotification"("expandedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserNotification_messageId_userId_key" ON "UserNotification"("messageId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserNotification_id_messageId_key" ON "UserNotification"("id", "messageId");

-- CreateIndex
CREATE INDEX "PushDelivery_status_nextAttemptAt_leaseUntil_idx" ON "PushDelivery"("status", "nextAttemptAt", "leaseUntil");

-- CreateIndex
CREATE INDEX "PushDelivery_messageId_status_idx" ON "PushDelivery"("messageId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PushDelivery_userNotificationId_deviceId_key" ON "PushDelivery"("userNotificationId", "deviceId");

-- CreateIndex
CREATE INDEX "fm_home_history_lookup" ON "FleetManagerHomeHistory"("clientId", "entityType", "entityId", "recordedAt", "id");

-- CreateIndex
CREATE INDEX "PenaltyHandoverException_clientId_riderId_approvedAt_idx" ON "PenaltyHandoverException"("clientId", "riderId", "approvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PenaltyHandoverException_clientId_allocationId_debtDigest_key" ON "PenaltyHandoverException"("clientId", "allocationId", "debtDigest");

-- CreateIndex
CREATE UNIQUE INDEX "FleetReadinessPolicy_clientId_version_key" ON "FleetReadinessPolicy"("clientId", "version");

-- CreateIndex
CREATE INDEX "FleetReadinessStaff_clientId_hubId_idx" ON "FleetReadinessStaff"("clientId", "hubId");

-- CreateIndex
CREATE UNIQUE INDEX "FleetReadinessStaff_clientId_userId_hubId_key" ON "FleetReadinessStaff"("clientId", "userId", "hubId");

-- CreateIndex
CREATE INDEX "FleetPreparation_clientId_hubId_status_idx" ON "FleetPreparation"("clientId", "hubId", "status");

-- CreateIndex
CREATE INDEX "FleetPreparation_clientId_fleetId_createdAt_idx" ON "FleetPreparation"("clientId", "fleetId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FleetPreparation_clientId_id_key" ON "FleetPreparation"("clientId", "id");

-- CreateIndex
CREATE INDEX "FleetPreparationRevision_clientId_preparationId_idx" ON "FleetPreparationRevision"("clientId", "preparationId");

-- CreateIndex
CREATE UNIQUE INDEX "FleetPreparationRevision_preparationId_revision_key" ON "FleetPreparationRevision"("preparationId", "revision");

-- CreateIndex
CREATE INDEX "FleetPreparationEvent_clientId_preparationId_createdAt_idx" ON "FleetPreparationEvent"("clientId", "preparationId", "createdAt");

-- CreateIndex
CREATE INDEX "FleetInstallationStage_clientId_status_idx" ON "FleetInstallationStage"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FleetInstallationStage_preparationId_code_key" ON "FleetInstallationStage"("preparationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "SparePartMaster_code_key" ON "SparePartMaster"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SpareCatalogueRevision_masterSpareId_version_key" ON "SpareCatalogueRevision"("masterSpareId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SpareCatalogueRevision_priceId_version_key" ON "SpareCatalogueRevision"("priceId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RazorpayDeploymentOrder_providerOrderId_key" ON "RazorpayDeploymentOrder"("providerOrderId");

-- CreateIndex
CREATE INDEX "RazorpayDeploymentOrder_deploymentPaymentId_createdAt_idx" ON "RazorpayDeploymentOrder"("deploymentPaymentId", "createdAt");

-- CreateIndex
CREATE INDEX "RazorpayDeploymentOrder_status_checkedAt_idx" ON "RazorpayDeploymentOrder"("status", "checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RazorpayDeploymentCapture_providerPaymentId_key" ON "RazorpayDeploymentCapture"("providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "RazorpayDeploymentCapture_providerRefundId_key" ON "RazorpayDeploymentCapture"("providerRefundId");

-- CreateIndex
CREATE INDEX "RazorpayDeploymentCapture_status_updatedAt_idx" ON "RazorpayDeploymentCapture"("status", "updatedAt");

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

-- CreateIndex
CREATE UNIQUE INDEX "RazorpayAutoPayCapture_providerPaymentId_key" ON "RazorpayAutoPayCapture"("providerPaymentId");

-- CreateIndex
CREATE INDEX "RazorpayAutoPayCapture_transactionId_createdAt_idx" ON "RazorpayAutoPayCapture"("transactionId", "createdAt");

-- CreateIndex
CREATE INDEX "RazorpayAutoPayCapture_status_createdAt_idx" ON "RazorpayAutoPayCapture"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "ClientSettlementPolicy" ADD CONSTRAINT "ClientSettlementPolicy_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientWorkPartner" ADD CONSTRAINT "ClientWorkPartner_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientWorkPartner" ADD CONSTRAINT "ClientWorkPartner_sourceMasterId_fkey" FOREIGN KEY ("sourceMasterId") REFERENCES "WorkPartnerMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleType" ADD CONSTRAINT "VehicleType_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "VehicleCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feature" ADD CONSTRAINT "Feature_featureStepId_fkey" FOREIGN KEY ("featureStepId") REFERENCES "FeatureStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureStep" ADD CONSTRAINT "FeatureStep_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "FeatureStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureRevision" ADD CONSTRAINT "FeatureRevision_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageRevision" ADD CONSTRAINT "PackageRevision_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageFeature" ADD CONSTRAINT "PackageFeature_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageFeature" ADD CONSTRAINT "PackageFeature_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeaturePricing" ADD CONSTRAINT "FeaturePricing_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageVehicleTierPricing" ADD CONSTRAINT "PackageVehicleTierPricing_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureAddOn" ADD CONSTRAINT "FeatureAddOn_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingContent" ADD CONSTRAINT "TrainingContent_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBusinessProfile" ADD CONSTRAINT "ClientBusinessProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAddress" ADD CONSTRAINT "ClientAddress_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientOperationsProfile" ADD CONSTRAINT "ClientOperationsProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientOperationsVehicleCategory" ADD CONSTRAINT "ClientOperationsVehicleCategory_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientOperationsVehicleCategory" ADD CONSTRAINT "ClientOperationsVehicleCategory_operationsProfileId_fkey" FOREIGN KEY ("operationsProfileId") REFERENCES "ClientOperationsProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientOperationsVehicleCategory" ADD CONSTRAINT "ClientOperationsVehicleCategory_vehicleCategoryId_fkey" FOREIGN KEY ("vehicleCategoryId") REFERENCES "VehicleCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBillingProfile" ADD CONSTRAINT "ClientBillingProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAgreement" ADD CONSTRAINT "ClientAgreement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSubscription" ADD CONSTRAINT "ClientSubscription_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSubscription" ADD CONSTRAINT "ClientSubscription_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSubscription" ADD CONSTRAINT "ClientSubscription_packageRevisionId_fkey" FOREIGN KEY ("packageRevisionId") REFERENCES "PackageRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientWorkflowRevision" ADD CONSTRAINT "ClientWorkflowRevision_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ClientSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFeature" ADD CONSTRAINT "ClientFeature_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFeature" ADD CONSTRAINT "ClientFeature_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ClientSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFeature" ADD CONSTRAINT "ClientFeature_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFeaturePricing" ADD CONSTRAINT "ClientFeaturePricing_clientFeatureId_fkey" FOREIGN KEY ("clientFeatureId") REFERENCES "ClientFeature"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFeaturePricing" ADD CONSTRAINT "ClientFeaturePricing_featurePricingId_fkey" FOREIGN KEY ("featurePricingId") REFERENCES "FeaturePricing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPricingAdjustment" ADD CONSTRAINT "ClientPricingAdjustment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPricingAdjustment" ADD CONSTRAINT "ClientPricingAdjustment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ClientSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFeatureAddOnPurchase" ADD CONSTRAINT "ClientFeatureAddOnPurchase_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFeatureAddOnPurchase" ADD CONSTRAINT "ClientFeatureAddOnPurchase_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ClientSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFeatureAddOnPurchase" ADD CONSTRAINT "ClientFeatureAddOnPurchase_featureAddOnId_fkey" FOREIGN KEY ("featureAddOnId") REFERENCES "FeatureAddOn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFeatureAddOnPurchase" ADD CONSTRAINT "ClientFeatureAddOnPurchase_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureCreditLot" ADD CONSTRAINT "FeatureCreditLot_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureCreditLot" ADD CONSTRAINT "FeatureCreditLot_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ClientSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureCreditLot" ADD CONSTRAINT "FeatureCreditLot_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureCreditLot" ADD CONSTRAINT "FeatureCreditLot_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "ClientFeatureAddOnPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureUsageLedger" ADD CONSTRAINT "FeatureUsageLedger_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureUsageLedger" ADD CONSTRAINT "FeatureUsageLedger_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ClientSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureUsageLedger" ADD CONSTRAINT "FeatureUsageLedger_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureUsageLedger" ADD CONSTRAINT "FeatureUsageLedger_creditLotId_fkey" FOREIGN KEY ("creditLotId") REFERENCES "FeatureCreditLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hub" ADD CONSTRAINT "Hub_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hub" ADD CONSTRAINT "Hub_parentHubId_fkey" FOREIGN KEY ("parentHubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_oemId_fkey" FOREIGN KEY ("oemId") REFERENCES "Oem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_vehicleCategoryId_fkey" FOREIGN KEY ("vehicleCategoryId") REFERENCES "VehicleCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_vehicleTypeId_fkey" FOREIGN KEY ("vehicleTypeId") REFERENCES "VehicleType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_homeHubId_fkey" FOREIGN KEY ("homeHubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_currentHubId_fkey" FOREIGN KEY ("currentHubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_iotDeviceId_fkey" FOREIGN KEY ("iotDeviceId") REFERENCES "IoTDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetRegistration" ADD CONSTRAINT "FleetRegistration_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetInsurance" ADD CONSTRAINT "FleetInsurance_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetFitness" ADD CONSTRAINT "FleetFitness_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetDocument" ADD CONSTRAINT "FleetDocument_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IoTDevice" ADD CONSTRAINT "IoTDevice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleCurrentState" ADD CONSTRAINT "VehicleCurrentState_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleCurrentState" ADD CONSTRAINT "VehicleCurrentState_iotDeviceId_fkey" FOREIGN KEY ("iotDeviceId") REFERENCES "IoTDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Battery" ADD CONSTRAINT "Battery_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetBatteryHistory" ADD CONSTRAINT "FleetBatteryHistory_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetBatteryHistory" ADD CONSTRAINT "FleetBatteryHistory_batteryId_fkey" FOREIGN KEY ("batteryId") REFERENCES "Battery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Controller" ADD CONSTRAINT "Controller_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetControllerHistory" ADD CONSTRAINT "FleetControllerHistory_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetControllerHistory" ADD CONSTRAINT "FleetControllerHistory_controllerId_fkey" FOREIGN KEY ("controllerId") REFERENCES "Controller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetStatusHistory" ADD CONSTRAINT "FleetStatusHistory_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetTransfer" ADD CONSTRAINT "FleetTransfer_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetTransfer" ADD CONSTRAINT "FleetTransfer_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetTransfer" ADD CONSTRAINT "FleetTransfer_fromHubId_fkey" FOREIGN KEY ("fromHubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetTransfer" ADD CONSTRAINT "FleetTransfer_toHubId_fkey" FOREIGN KEY ("toHubId") REFERENCES "Hub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rider" ADD CONSTRAINT "Rider_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rider" ADD CONSTRAINT "Rider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMandate" ADD CONSTRAINT "PaymentMandate_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMandate" ADD CONSTRAINT "PaymentMandate_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMandateEvent" ADD CONSTRAINT "PaymentMandateEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMandateEvent" ADD CONSTRAINT "PaymentMandateEvent_clientId_mandateId_fkey" FOREIGN KEY ("clientId", "mandateId") REFERENCES "PaymentMandate"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProviderEvent" ADD CONSTRAINT "PaymentProviderEvent_deploymentOrderId_fkey" FOREIGN KEY ("deploymentOrderId") REFERENCES "RazorpayDeploymentOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProviderEvent" ADD CONSTRAINT "PaymentProviderEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProviderEvent" ADD CONSTRAINT "PaymentProviderEvent_clientId_mandateId_fkey" FOREIGN KEY ("clientId", "mandateId") REFERENCES "PaymentMandate"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProviderEvent" ADD CONSTRAINT "PaymentProviderEvent_clientId_paymentTransactionId_fkey" FOREIGN KEY ("clientId", "paymentTransactionId") REFERENCES "PaymentTransaction"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProviderEvent" ADD CONSTRAINT "PaymentProviderEvent_collectionRequestId_fkey" FOREIGN KEY ("collectionRequestId") REFERENCES "PaymentCollectionRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_clientId_invoiceId_fkey" FOREIGN KEY ("clientId", "invoiceId") REFERENCES "RiderInvoice"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_clientId_mandateId_fkey" FOREIGN KEY ("clientId", "mandateId") REFERENCES "PaymentMandate"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_riderPaymentId_fkey" FOREIGN KEY ("riderPaymentId") REFERENCES "RiderPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_clientId_transactionId_fkey" FOREIGN KEY ("clientId", "transactionId") REFERENCES "PaymentTransaction"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_collectionRequestId_fkey" FOREIGN KEY ("collectionRequestId") REFERENCES "PaymentCollectionRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoPayDunningCase" ADD CONSTRAINT "AutoPayDunningCase_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoPayDunningCase" ADD CONSTRAINT "AutoPayDunningCase_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoPayDunningCase" ADD CONSTRAINT "AutoPayDunningCase_clientId_invoiceId_fkey" FOREIGN KEY ("clientId", "invoiceId") REFERENCES "RiderInvoice"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCollectionRequest" ADD CONSTRAINT "PaymentCollectionRequest_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCollectionRequest" ADD CONSTRAINT "PaymentCollectionRequest_clientId_invoiceId_fkey" FOREIGN KEY ("clientId", "invoiceId") REFERENCES "RiderInvoice"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCollectionRequest" ADD CONSTRAINT "PaymentCollectionRequest_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "RiderDeposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCollectionRequest" ADD CONSTRAINT "PaymentCollectionRequest_riderPaymentId_fkey" FOREIGN KEY ("riderPaymentId") REFERENCES "RiderPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCollectionRequest" ADD CONSTRAINT "PaymentCollectionRequest_depositTransactionId_fkey" FOREIGN KEY ("depositTransactionId") REFERENCES "RiderDepositTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderPaymentObservation" ADD CONSTRAINT "ProviderPaymentObservation_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "PaymentCollectionRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderPaymentProfile" ADD CONSTRAINT "RiderPaymentProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderPaymentProfile" ADD CONSTRAINT "RiderPaymentProfile_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderCharge" ADD CONSTRAINT "RiderCharge_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderCharge" ADD CONSTRAINT "RiderCharge_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderCharge" ADD CONSTRAINT "RiderCharge_clientId_invoiceId_fkey" FOREIGN KEY ("clientId", "invoiceId") REFERENCES "RiderInvoice"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderCredit" ADD CONSTRAINT "RiderCredit_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderCredit" ADD CONSTRAINT "RiderCredit_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderLedgerEntry" ADD CONSTRAINT "RiderLedgerEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderLedgerEntry" ADD CONSTRAINT "RiderLedgerEntry_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderDeposit" ADD CONSTRAINT "RiderDeposit_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderDeposit" ADD CONSTRAINT "RiderDeposit_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "RiderRentalAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderDepositTransaction" ADD CONSTRAINT "RiderDepositTransaction_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "RiderDeposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderDepositRefundRequest" ADD CONSTRAINT "RiderDepositRefundRequest_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "RiderDeposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderInvoice" ADD CONSTRAINT "RiderInvoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderInvoice" ADD CONSTRAINT "RiderInvoice_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderInvoice" ADD CONSTRAINT "RiderInvoice_billingPeriodId_fkey" FOREIGN KEY ("billingPeriodId") REFERENCES "RiderBillingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderSettlementCreditApplication" ADD CONSTRAINT "RiderSettlementCreditApplication_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "RiderCredit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderSettlementCreditApplication" ADD CONSTRAINT "RiderSettlementCreditApplication_clientId_invoiceId_fkey" FOREIGN KEY ("clientId", "invoiceId") REFERENCES "RiderInvoice"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderInvoiceLine" ADD CONSTRAINT "RiderInvoiceLine_clientId_invoiceId_fkey" FOREIGN KEY ("clientId", "invoiceId") REFERENCES "RiderInvoice"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderBillingSchedule" ADD CONSTRAINT "RiderBillingSchedule_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderBillingSchedule" ADD CONSTRAINT "RiderBillingSchedule_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "RiderRentalAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderBillingPeriod" ADD CONSTRAINT "RiderBillingPeriod_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderBillingPeriod" ADD CONSTRAINT "RiderBillingPeriod_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "RiderBillingSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderTaxRule" ADD CONSTRAINT "RiderTaxRule_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "RiderTaxProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderPayment" ADD CONSTRAINT "RiderPayment_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderPaymentAllocation" ADD CONSTRAINT "RiderPaymentAllocation_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderPaymentAllocation" ADD CONSTRAINT "RiderPaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "RiderPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderPaymentAllocation" ADD CONSTRAINT "RiderPaymentAllocation_clientId_invoiceId_fkey" FOREIGN KEY ("clientId", "invoiceId") REFERENCES "RiderInvoice"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_clientId_paymentId_fkey" FOREIGN KEY ("clientId", "paymentId") REFERENCES "RiderPayment"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderSettlementItem" ADD CONSTRAINT "ProviderSettlementItem_clientId_settlementId_fkey" FOREIGN KEY ("clientId", "settlementId") REFERENCES "ProviderSettlement"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderOnboardingProgress" ADD CONSTRAINT "RiderOnboardingProgress_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderOnboardingProgress" ADD CONSTRAINT "RiderOnboardingProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserHub" ADD CONSTRAINT "UserHub_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserHub" ADD CONSTRAINT "UserHub_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserHub" ADD CONSTRAINT "UserHub_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamLeaderProfile" ADD CONSTRAINT "TeamLeaderProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamLeaderProfile" ADD CONSTRAINT "TeamLeaderProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamLeaderRider" ADD CONSTRAINT "TeamLeaderRider_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamLeaderRider" ADD CONSTRAINT "TeamLeaderRider_teamLeaderId_fkey" FOREIGN KEY ("teamLeaderId") REFERENCES "TeamLeaderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamLeaderRider" ADD CONSTRAINT "TeamLeaderRider_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientOnboardingProgress" ADD CONSTRAINT "ClientOnboardingProgress_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientOnboardingStepRecord" ADD CONSTRAINT "ClientOnboardingStepRecord_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientOnboardingStepRecord" ADD CONSTRAINT "ClientOnboardingStepRecord_progressId_fkey" FOREIGN KEY ("progressId") REFERENCES "ClientOnboardingProgress"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_clientId_commercialOfferId_fkey" FOREIGN KEY ("clientId", "commercialOfferId") REFERENCES "RiderCommercialOffer"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_clientId_rentalAgreementId_fkey" FOREIGN KEY ("clientId", "rentalAgreementId") REFERENCES "RiderRentalAgreement"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileDeploymentWorkflow" ADD CONSTRAINT "MobileDeploymentWorkflow_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "Allocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileDeploymentWorkflow" ADD CONSTRAINT "MobileDeploymentWorkflow_clientId_clientWorkPartnerId_fkey" FOREIGN KEY ("clientId", "clientWorkPartnerId") REFERENCES "ClientWorkPartner"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentPayment" ADD CONSTRAINT "DeploymentPayment_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "MobileDeploymentWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "Allocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderKyc" ADD CONSTRAINT "RiderKyc_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycProviderCapability" ADD CONSTRAINT "KycProviderCapability_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "KycProviderConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycProviderCredential" ADD CONSTRAINT "KycProviderCredential_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "KycProviderConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycProviderCredential" ADD CONSTRAINT "KycProviderCredential_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycConsent" ADD CONSTRAINT "KycConsent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycConsent" ADD CONSTRAINT "KycConsent_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycConsent" ADD CONSTRAINT "KycConsent_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "KycProviderConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycVerification" ADD CONSTRAINT "KycVerification_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycVerification" ADD CONSTRAINT "KycVerification_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycVerification" ADD CONSTRAINT "KycVerification_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "KycConsent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycVerification" ADD CONSTRAINT "KycVerification_finalProviderId_fkey" FOREIGN KEY ("finalProviderId") REFERENCES "KycProviderConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycClientPolicy" ADD CONSTRAINT "KycClientPolicy_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureUsageConsumption" ADD CONSTRAINT "FeatureUsageConsumption_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureUsageConsumption" ADD CONSTRAINT "FeatureUsageConsumption_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ClientSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureUsageConsumption" ADD CONSTRAINT "FeatureUsageConsumption_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureUsageConsumption" ADD CONSTRAINT "FeatureUsageConsumption_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "KycVerification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycVerificationAttempt" ADD CONSTRAINT "KycVerificationAttempt_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "KycVerification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycVerificationAttempt" ADD CONSTRAINT "KycVerificationAttempt_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "KycProviderConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycProviderSlaPolicy" ADD CONSTRAINT "KycProviderSlaPolicy_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "KycProviderConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycRoutingProvider" ADD CONSTRAINT "KycRoutingProvider_routingPolicyId_fkey" FOREIGN KEY ("routingPolicyId") REFERENCES "KycRoutingPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycRoutingProvider" ADD CONSTRAINT "KycRoutingProvider_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "KycProviderConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycRoutingDecision" ADD CONSTRAINT "KycRoutingDecision_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "KycVerification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycRoutingDecision" ADD CONSTRAINT "KycRoutingDecision_routingPolicyId_fkey" FOREIGN KEY ("routingPolicyId") REFERENCES "KycRoutingPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycProviderConflict" ADD CONSTRAINT "KycProviderConflict_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "KycVerification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycProviderConflict" ADD CONSTRAINT "KycProviderConflict_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "KycProviderConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycVerificationResult" ADD CONSTRAINT "KycVerificationResult_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "KycVerification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycVerificationResult" ADD CONSTRAINT "KycVerificationResult_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "KycVerificationAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycWorkflowStep" ADD CONSTRAINT "KycWorkflowStep_workflowDefinitionId_fkey" FOREIGN KEY ("workflowDefinitionId") REFERENCES "KycWorkflowDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycWorkflowExecution" ADD CONSTRAINT "KycWorkflowExecution_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycWorkflowExecution" ADD CONSTRAINT "KycWorkflowExecution_workflowDefinitionId_fkey" FOREIGN KEY ("workflowDefinitionId") REFERENCES "KycWorkflowDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycWorkflowStepExecution" ADD CONSTRAINT "KycWorkflowStepExecution_workflowExecutionId_fkey" FOREIGN KEY ("workflowExecutionId") REFERENCES "KycWorkflowExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycWorkflowStepExecution" ADD CONSTRAINT "KycWorkflowStepExecution_workflowStepId_fkey" FOREIGN KEY ("workflowStepId") REFERENCES "KycWorkflowStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycWorkflowStepExecution" ADD CONSTRAINT "KycWorkflowStepExecution_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "KycVerification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycDecisionRule" ADD CONSTRAINT "KycDecisionRule_workflowDefinitionId_fkey" FOREIGN KEY ("workflowDefinitionId") REFERENCES "KycWorkflowDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycDecision" ADD CONSTRAINT "KycDecision_workflowExecutionId_fkey" FOREIGN KEY ("workflowExecutionId") REFERENCES "KycWorkflowExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycDecision" ADD CONSTRAINT "KycDecision_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "KycDecisionRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycReconciliationResult" ADD CONSTRAINT "KycReconciliationResult_workflowExecutionId_fkey" FOREIGN KEY ("workflowExecutionId") REFERENCES "KycWorkflowExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderOnboardingDocument" ADD CONSTRAINT "RiderOnboardingDocument_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderOnboardingDocument" ADD CONSTRAINT "RiderOnboardingDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderOnboardingDocument" ADD CONSTRAINT "RiderOnboardingDocument_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderOnboardingDocument" ADD CONSTRAINT "RiderOnboardingDocument_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderOnboardingDocument" ADD CONSTRAINT "RiderOnboardingDocument_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendancePeriod" ADD CONSTRAINT "AttendancePeriod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendancePeriod" ADD CONSTRAINT "AttendancePeriod_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDomain" ADD CONSTRAINT "ClientDomain_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBranding" ADD CONSTRAINT "ClientBranding_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE "RiderRateCard" ADD CONSTRAINT "RiderRateCard_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderRateCardVersion" ADD CONSTRAINT "RiderRateCardVersion_clientId_rateCardId_fkey" FOREIGN KEY ("clientId", "rateCardId") REFERENCES "RiderRateCard"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCardRentalRate" ADD CONSTRAINT "RateCardRentalRate_clientId_rateCardVersionId_fkey" FOREIGN KEY ("clientId", "rateCardVersionId") REFERENCES "RiderRateCardVersion"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCardFee" ADD CONSTRAINT "RateCardFee_clientId_rateCardVersionId_fkey" FOREIGN KEY ("clientId", "rateCardVersionId") REFERENCES "RiderRateCardVersion"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCardDeposit" ADD CONSTRAINT "RateCardDeposit_clientId_rateCardVersionId_fkey" FOREIGN KEY ("clientId", "rateCardVersionId") REFERENCES "RiderRateCardVersion"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCardAdjustment" ADD CONSTRAINT "RateCardAdjustment_clientId_rateCardVersionId_fkey" FOREIGN KEY ("clientId", "rateCardVersionId") REFERENCES "RiderRateCardVersion"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderBatteryPlan" ADD CONSTRAINT "RiderBatteryPlan_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleCommercialGradeAssignment" ADD CONSTRAINT "VehicleCommercialGradeAssignment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleCommercialGradeAssignment" ADD CONSTRAINT "VehicleCommercialGradeAssignment_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderPromotion" ADD CONSTRAINT "RiderPromotion_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderCommercialTerms" ADD CONSTRAINT "RiderCommercialTerms_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppLegalDocument" ADD CONSTRAINT "AppLegalDocument_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppLegalAcceptance" ADD CONSTRAINT "AppLegalAcceptance_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppLegalAcceptance" ADD CONSTRAINT "AppLegalAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppLegalAcceptance" ADD CONSTRAINT "AppLegalAcceptance_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "AppLegalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderCommercialOffer" ADD CONSTRAINT "RiderCommercialOffer_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderRentalAgreement" ADD CONSTRAINT "RiderRentalAgreement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderRentalAgreement" ADD CONSTRAINT "RiderRentalAgreement_commercialOfferId_fkey" FOREIGN KEY ("commercialOfferId") REFERENCES "RiderCommercialOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalTerminationRequest" ADD CONSTRAINT "RentalTerminationRequest_clientId_agreementId_fkey" FOREIGN KEY ("clientId", "agreementId") REFERENCES "RiderRentalAgreement"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalTerminationRequest" ADD CONSTRAINT "RentalTerminationRequest_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "Allocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalTerminationRequest" ADD CONSTRAINT "RentalTerminationRequest_plannedHubId_fkey" FOREIGN KEY ("plannedHubId") REFERENCES "Hub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalTerminationRequest" ADD CONSTRAINT "RentalTerminationRequest_receivedHubId_fkey" FOREIGN KEY ("receivedHubId") REFERENCES "Hub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnPenaltyPrice" ADD CONSTRAINT "ReturnPenaltyPrice_masterSpareId_fkey" FOREIGN KEY ("masterSpareId") REFERENCES "SparePartMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnPenaltyPrice" ADD CONSTRAINT "ReturnPenaltyPrice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnPenaltyCase" ADD CONSTRAINT "ReturnPenaltyCase_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnPenaltyCase" ADD CONSTRAINT "ReturnPenaltyCase_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnPenaltyCase" ADD CONSTRAINT "ReturnPenaltyCase_terminationRequestId_fkey" FOREIGN KEY ("terminationRequestId") REFERENCES "RentalTerminationRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnPenaltyCase" ADD CONSTRAINT "ReturnPenaltyCase_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnPenaltyCase" ADD CONSTRAINT "ReturnPenaltyCase_postedChargeId_fkey" FOREIGN KEY ("postedChargeId") REFERENCES "RiderCharge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnPenaltyItem" ADD CONSTRAINT "ReturnPenaltyItem_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ReturnPenaltyCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnPenaltyItem" ADD CONSTRAINT "ReturnPenaltyItem_priceListItemId_fkey" FOREIGN KEY ("priceListItemId") REFERENCES "ReturnPenaltyPrice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportReply" ADD CONSTRAINT "SupportReply_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportReply" ADD CONSTRAINT "SupportReply_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderFinalSettlement" ADD CONSTRAINT "RiderFinalSettlement_clientId_agreementId_fkey" FOREIGN KEY ("clientId", "agreementId") REFERENCES "RiderRentalAgreement"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementRevision" ADD CONSTRAINT "SettlementRevision_clientId_settlementId_fkey" FOREIGN KEY ("clientId", "settlementId") REFERENCES "RiderFinalSettlement"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementChargeAssessment" ADD CONSTRAINT "SettlementChargeAssessment_clientId_settlementId_fkey" FOREIGN KEY ("clientId", "settlementId") REFERENCES "RiderFinalSettlement"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementDepositHold" ADD CONSTRAINT "SettlementDepositHold_clientId_settlementId_fkey" FOREIGN KEY ("clientId", "settlementId") REFERENCES "RiderFinalSettlement"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementDepositApplication" ADD CONSTRAINT "SettlementDepositApplication_clientId_settlementId_fkey" FOREIGN KEY ("clientId", "settlementId") REFERENCES "RiderFinalSettlement"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementRefundRequest" ADD CONSTRAINT "SettlementRefundRequest_clientId_settlementId_fkey" FOREIGN KEY ("clientId", "settlementId") REFERENCES "RiderFinalSettlement"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementAdjustment" ADD CONSTRAINT "SettlementAdjustment_clientId_settlementId_fkey" FOREIGN KEY ("clientId", "settlementId") REFERENCES "RiderFinalSettlement"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderRentalAgreementStatusHistory" ADD CONSTRAINT "RiderRentalAgreementStatusHistory_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "RiderRentalAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderRentalAgreementAmendment" ADD CONSTRAINT "RiderRentalAgreementAmendment_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "RiderRentalAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientExchangePolicy" ADD CONSTRAINT "ClientExchangePolicy_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderAgreementCommercialVersion" ADD CONSTRAINT "RiderAgreementCommercialVersion_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "RiderRentalAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleExchangeRequest" ADD CONSTRAINT "VehicleExchangeRequest_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "RiderRentalAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleExchangeOffer" ADD CONSTRAINT "VehicleExchangeOffer_exchangeRequestId_fkey" FOREIGN KEY ("exchangeRequestId") REFERENCES "VehicleExchangeRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionPolicyVersion" ADD CONSTRAINT "CollectionPolicyVersion_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "CollectionPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionPolicyStage" ADD CONSTRAINT "CollectionPolicyStage_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "CollectionPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionCaseInvoice" ADD CONSTRAINT "CollectionCaseInvoice_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RiderCollectionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionAction" ADD CONSTRAINT "CollectionAction_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RiderCollectionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromiseToPay" ADD CONSTRAINT "PromiseToPay_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RiderCollectionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionCaseNote" ADD CONSTRAINT "CollectionCaseNote_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RiderCollectionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionTask" ADD CONSTRAINT "CollectionTask_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RiderCollectionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionWaiver" ADD CONSTRAINT "CollectionWaiver_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RiderCollectionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionDispute" ADD CONSTRAINT "CollectionDispute_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RiderCollectionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialRestriction" ADD CONSTRAINT "CommercialRestriction_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RiderCollectionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionEvent" ADD CONSTRAINT "CollectionEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RiderCollectionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderWallet" ADD CONSTRAINT "RiderWallet_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderWallet" ADD CONSTRAINT "RiderWallet_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletAccount" ADD CONSTRAINT "WalletAccount_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletAccount" ADD CONSTRAINT "WalletAccount_clientId_walletId_fkey" FOREIGN KEY ("clientId", "walletId") REFERENCES "RiderWallet"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_clientId_walletId_fkey" FOREIGN KEY ("clientId", "walletId") REFERENCES "RiderWallet"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_parentTransactionId_fkey" FOREIGN KEY ("parentTransactionId") REFERENCES "WalletTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_clientId_transactionId_fkey" FOREIGN KEY ("clientId", "transactionId") REFERENCES "WalletTransaction"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_clientId_walletId_accountId_fkey" FOREIGN KEY ("clientId", "walletId", "accountId") REFERENCES "WalletAccount"("clientId", "walletId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletHold" ADD CONSTRAINT "WalletHold_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletHold" ADD CONSTRAINT "WalletHold_clientId_walletId_fkey" FOREIGN KEY ("clientId", "walletId") REFERENCES "RiderWallet"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletHold" ADD CONSTRAINT "WalletHold_clientId_walletId_accountId_fkey" FOREIGN KEY ("clientId", "walletId", "accountId") REFERENCES "WalletAccount"("clientId", "walletId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletPolicy" ADD CONSTRAINT "WalletPolicy_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletSecurityDeposit" ADD CONSTRAINT "WalletSecurityDeposit_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletSecurityDeposit" ADD CONSTRAINT "WalletSecurityDeposit_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletSecurityDeposit" ADD CONSTRAINT "WalletSecurityDeposit_clientId_riderId_walletId_fkey" FOREIGN KEY ("clientId", "riderId", "walletId") REFERENCES "RiderWallet"("clientId", "riderId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletDepositRefundRequest" ADD CONSTRAINT "WalletDepositRefundRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletDepositRefundRequest" ADD CONSTRAINT "WalletDepositRefundRequest_clientId_depositId_fkey" FOREIGN KEY ("clientId", "depositId") REFERENCES "WalletSecurityDeposit"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletInvoiceAllocation" ADD CONSTRAINT "WalletInvoiceAllocation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletInvoiceAllocation" ADD CONSTRAINT "WalletInvoiceAllocation_clientId_invoiceId_fkey" FOREIGN KEY ("clientId", "invoiceId") REFERENCES "RiderInvoice"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletInvoiceAllocation" ADD CONSTRAINT "WalletInvoiceAllocation_clientId_transactionId_fkey" FOREIGN KEY ("clientId", "transactionId") REFERENCES "WalletTransaction"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletInvoiceAllocation" ADD CONSTRAINT "WalletInvoiceAllocation_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "WalletInvoiceAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardProgram" ADD CONSTRAINT "RewardProgram_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRule" ADD CONSTRAINT "RewardRule_clientId_programId_fkey" FOREIGN KEY ("clientId", "programId") REFERENCES "RewardProgram"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardClaim" ADD CONSTRAINT "RewardClaim_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardClaim" ADD CONSTRAINT "RewardClaim_clientId_programId_fkey" FOREIGN KEY ("clientId", "programId") REFERENCES "RewardProgram"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardClaim" ADD CONSTRAINT "RewardClaim_clientId_ruleId_fkey" FOREIGN KEY ("clientId", "ruleId") REFERENCES "RewardRule"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardClaim" ADD CONSTRAINT "RewardClaim_clientId_walletTransactionId_fkey" FOREIGN KEY ("clientId", "walletTransactionId") REFERENCES "WalletTransaction"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardLot" ADD CONSTRAINT "RewardLot_clientId_claimId_fkey" FOREIGN KEY ("clientId", "claimId") REFERENCES "RewardClaim"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardLotConsumption" ADD CONSTRAINT "RewardLotConsumption_clientId_lotId_fkey" FOREIGN KEY ("clientId", "lotId") REFERENCES "RewardLot"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardLotConsumption" ADD CONSTRAINT "RewardLotConsumption_clientId_transactionId_fkey" FOREIGN KEY ("clientId", "transactionId") REFERENCES "WalletTransaction"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardEvent" ADD CONSTRAINT "RewardEvent_clientId_claimId_fkey" FOREIGN KEY ("clientId", "claimId") REFERENCES "RewardClaim"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderReferenceReview" ADD CONSTRAINT "RiderReferenceReview_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderReferenceReview" ADD CONSTRAINT "RiderReferenceReview_clientId_reviewedById_fkey" FOREIGN KEY ("clientId", "reviewedById") REFERENCES "User"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSubmission" ADD CONSTRAINT "VehicleSubmission_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSubmission" ADD CONSTRAINT "VehicleSubmission_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "Allocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSubmission" ADD CONSTRAINT "VehicleSubmission_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSubmission" ADD CONSTRAINT "VehicleSubmission_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "RentalTerminationRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSubmission" ADD CONSTRAINT "VehicleSubmission_exchangeRequestId_fkey" FOREIGN KEY ("exchangeRequestId") REFERENCES "VehicleExchangeRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSubmissionReport" ADD CONSTRAINT "VehicleSubmissionReport_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "VehicleSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSubmissionReport" ADD CONSTRAINT "VehicleSubmissionReport_postedChargeId_fkey" FOREIGN KEY ("postedChargeId") REFERENCES "RiderCharge"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_clientId_userId_fkey" FOREIGN KEY ("clientId", "userId") REFERENCES "User"("clientId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationMessage" ADD CONSTRAINT "NotificationMessage_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationMessage" ADD CONSTRAINT "NotificationMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_clientId_userId_fkey" FOREIGN KEY ("clientId", "userId") REFERENCES "User"("clientId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_clientId_messageId_fkey" FOREIGN KEY ("clientId", "messageId") REFERENCES "NotificationMessage"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDelivery" ADD CONSTRAINT "PushDelivery_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "NotificationMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDelivery" ADD CONSTRAINT "PushDelivery_userNotificationId_messageId_fkey" FOREIGN KEY ("userNotificationId", "messageId") REFERENCES "UserNotification"("id", "messageId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDelivery" ADD CONSTRAINT "PushDelivery_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PushDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenaltyHandoverException" ADD CONSTRAINT "PenaltyHandoverException_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenaltyHandoverException" ADD CONSTRAINT "PenaltyHandoverException_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenaltyHandoverException" ADD CONSTRAINT "PenaltyHandoverException_clientId_allocationId_fkey" FOREIGN KEY ("clientId", "allocationId") REFERENCES "Allocation"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenaltyHandoverException" ADD CONSTRAINT "PenaltyHandoverException_clientId_approvedById_fkey" FOREIGN KEY ("clientId", "approvedById") REFERENCES "User"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetReadinessPolicy" ADD CONSTRAINT "FleetReadinessPolicy_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetReadinessStaff" ADD CONSTRAINT "FleetReadinessStaff_clientId_userId_fkey" FOREIGN KEY ("clientId", "userId") REFERENCES "User"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetReadinessStaff" ADD CONSTRAINT "FleetReadinessStaff_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetPreparation" ADD CONSTRAINT "FleetPreparation_clientId_fleetId_fkey" FOREIGN KEY ("clientId", "fleetId") REFERENCES "Fleet"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetPreparation" ADD CONSTRAINT "FleetPreparation_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetPreparationRevision" ADD CONSTRAINT "FleetPreparationRevision_clientId_preparationId_fkey" FOREIGN KEY ("clientId", "preparationId") REFERENCES "FleetPreparation"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetPreparationEvent" ADD CONSTRAINT "FleetPreparationEvent_clientId_preparationId_fkey" FOREIGN KEY ("clientId", "preparationId") REFERENCES "FleetPreparation"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetInstallationStage" ADD CONSTRAINT "FleetInstallationStage_clientId_preparationId_fkey" FOREIGN KEY ("clientId", "preparationId") REFERENCES "FleetPreparation"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpareCatalogueRevision" ADD CONSTRAINT "SpareCatalogueRevision_masterSpareId_fkey" FOREIGN KEY ("masterSpareId") REFERENCES "SparePartMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpareCatalogueRevision" ADD CONSTRAINT "SpareCatalogueRevision_priceId_fkey" FOREIGN KEY ("priceId") REFERENCES "ReturnPenaltyPrice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RazorpayDeploymentOrder" ADD CONSTRAINT "RazorpayDeploymentOrder_clientId_deploymentPaymentId_fkey" FOREIGN KEY ("clientId", "deploymentPaymentId") REFERENCES "DeploymentPayment"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RazorpayDeploymentCapture" ADD CONSTRAINT "RazorpayDeploymentCapture_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "RazorpayDeploymentOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RazorpayPenaltyOrder" ADD CONSTRAINT "RazorpayPenaltyOrder_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "PaymentCollectionRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RazorpayPenaltyCapture" ADD CONSTRAINT "RazorpayPenaltyCapture_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "RazorpayPenaltyOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RazorpayAutoPayCapture" ADD CONSTRAINT "RazorpayAutoPayCapture_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "PaymentTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
