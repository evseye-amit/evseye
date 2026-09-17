import {
  BillingCycle,
  ClientIndustry,
  FleetBusinessModel,
  VehicleOwnership,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const phone = /^\+?[1-9]\d{7,14}$/;

/**
 * Required only when a Super Admin edits an ACTIVE client.  The platform does
 * not send or validate email itself; this reference links the audited change
 * to the approval retained by the operations team.
 */
class ActiveClientEditApprovalDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  approvalEmailReference?: string;
}

export class CreateClientDraftDto {
  @IsString() @MaxLength(120) businessFleetName!: string;
  @IsString() @Matches(/^[a-z0-9-]+$/) @MaxLength(80) companyCode!: string;
  @IsString() @MaxLength(180) legalEntityName!: string;
  @IsString() @MaxLength(60) businessType!: string;
  @IsString() @MaxLength(60) clientType!: string;
  @IsOptional() @IsEnum(ClientIndustry) industry?: ClientIndustry;
  // These identifiers intentionally use soft format validation in the UI so
  // onboarding drafts are not blocked when a client needs to correct details.
  // The API only normalizes the values before persisting them.
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @MaxLength(20)
  pan!: string;
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(30)
  gstin?: string;
  @IsOptional() @IsString() @MaxLength(30) cinOrLlpin?: string;
  @IsOptional() @IsUrl() website?: string;
  @IsOptional() @IsInt() @Min(1800) yearEstablished?: number;
  @IsInt() @Min(0) estimatedFleetSize!: number;
  @IsInt() @Min(0) estimatedRiderCount!: number;
  @IsOptional() @IsInt() @Min(0) estimatedUserCount?: number;
}

export class UpdateClientContactsAndAddressDto extends ActiveClientEditApprovalDto {
  @IsString() @MaxLength(120) primaryContactName!: string;
  @IsString() @MaxLength(100) primaryDesignation!: string;
  @IsString() @Matches(phone) primaryMobile!: string;
  @IsEmail() @MaxLength(180) primaryEmail!: string;
  @IsOptional() @IsString() @Matches(phone) alternateMobile?: string;
  @IsBoolean() adminSameAsPrimary!: boolean;
  @ValidateIf((dto) => !dto.adminSameAsPrimary)
  @IsString()
  @MaxLength(120)
  adminName?: string;
  @ValidateIf((dto) => !dto.adminSameAsPrimary)
  @IsString()
  @Matches(phone)
  adminMobile?: string;
  @ValidateIf((dto) => !dto.adminSameAsPrimary)
  @IsEmail()
  @MaxLength(180)
  adminEmail?: string;
  @IsOptional() @IsString() @MaxLength(100) adminDesignation?: string;
  @IsString() @MaxLength(180) registeredAddressLine1!: string;
  @IsOptional() @IsString() @MaxLength(180) registeredAddressLine2?: string;
  @IsOptional() @IsString() @MaxLength(120) landmark?: string;
  @IsString() @MaxLength(80) city!: string;
  @IsOptional() @IsString() @MaxLength(80) district?: string;
  @IsString() @MaxLength(80) state!: string;
  @IsOptional() @IsString() @MaxLength(80) country?: string;
  @IsString() @Matches(/^\d{4,10}$/) pinCode!: string;
  @IsBoolean() billingSameAsRegistered!: boolean;
  @ValidateIf((dto) => !dto.billingSameAsRegistered)
  @IsString()
  @MaxLength(180)
  billingAddressLine1?: string;
  @ValidateIf((dto) => !dto.billingSameAsRegistered)
  @IsOptional()
  @IsString()
  @MaxLength(180)
  billingAddressLine2?: string;
  @ValidateIf((dto) => !dto.billingSameAsRegistered)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  billingLandmark?: string;
  @ValidateIf((dto) => !dto.billingSameAsRegistered)
  @IsString()
  @MaxLength(80)
  billingCity?: string;
  @ValidateIf((dto) => !dto.billingSameAsRegistered)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  billingDistrict?: string;
  @ValidateIf((dto) => !dto.billingSameAsRegistered)
  @IsString()
  @MaxLength(80)
  billingState?: string;
  @ValidateIf((dto) => !dto.billingSameAsRegistered)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  billingCountry?: string;
  @ValidateIf((dto) => !dto.billingSameAsRegistered)
  @IsString()
  @Matches(/^\d{4,10}$/)
  billingPinCode?: string;
}

export class UpdateClientOperationsDto extends ActiveClientEditApprovalDto {
  @IsEnum(FleetBusinessModel) fleetBusinessModel!: FleetBusinessModel;
  @IsInt() @Min(1) numberOfFleets!: number;
  @IsInt() @Min(0) approximateRiderCount!: number;
  @IsEnum(VehicleOwnership) vehicleOwnership!: VehicleOwnership;
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  vehicleCategoryIds!: string[];
  @IsOptional() @IsInt() @Min(0) operationalHubCount?: number;
}

export class UpdateClientPackageSelectionDto extends ActiveClientEditApprovalDto {
  @IsString() packageId!: string;
  @IsEnum(BillingCycle) billingCycle!: BillingCycle;
  @IsDateString() startDate!: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsBoolean() trialRequired?: boolean;
  @IsBoolean() autoRenew!: boolean;
}

export class UpdateClientBillingDto extends ActiveClientEditApprovalDto {
  @IsString() @MaxLength(120) billingContactName!: string;
  @IsEmail() @MaxLength(180) billingEmail!: string;
  @IsOptional() @IsString() @Matches(phone) billingMobile?: string;
  @IsBoolean() purchaseOrderRequired!: boolean;
  @ValidateIf((dto) => dto.purchaseOrderRequired)
  @IsString()
  @MaxLength(100)
  poNumber?: string;
  @IsOptional() @IsString() @MaxLength(200) paymentTerms?: string;
}

export class UpdateClientAgreementDto extends ActiveClientEditApprovalDto {
  @IsString() @MaxLength(120) authorizedSignatoryName!: string;
  @IsString() @MaxLength(100) designation!: string;
  @IsBoolean() termsAccepted!: boolean;
  @IsBoolean() privacyAccepted!: boolean;
  @IsBoolean() dataProcessingConsent!: boolean;
  @IsOptional() @IsBoolean() kycConsent?: boolean;
  @IsOptional() @IsBoolean() marketingConsent?: boolean;
}

export class CreateClientDocumentUploadIntentDto extends ActiveClientEditApprovalDto {
  @IsString() documentType!: string;
  @IsOptional() @IsString() @MaxLength(100) documentNumber?: string;
  @IsOptional() @IsDateString() issueDate?: string;
  @IsOptional() @IsDateString() expiryDate?: string;
  @IsString() @MaxLength(255) fileName!: string;
  @IsString()
  @IsIn(['application/pdf', 'image/jpeg', 'image/png'])
  mimeType!: string;
  @IsInt() @Min(1) sizeBytes!: number;
}

export class UpdateClientBusinessDetailsDto extends ActiveClientEditApprovalDto {
  @IsString() @MaxLength(120) businessFleetName!: string;
  @IsString() @MaxLength(180) legalEntityName!: string;
  @IsString() @MaxLength(60) businessType!: string;
  @IsString() @MaxLength(60) clientType!: string;
  @IsOptional() @IsEnum(ClientIndustry) industry?: ClientIndustry;
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @MaxLength(20)
  pan!: string;
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(30)
  gstin?: string;
  @IsOptional() @IsString() @MaxLength(30) cinOrLlpin?: string;
  @IsOptional() @IsUrl() website?: string;
  @IsOptional() @IsInt() @Min(1800) yearEstablished?: number;
  @IsInt() @Min(0) estimatedFleetSize!: number;
  @IsInt() @Min(0) estimatedRiderCount!: number;
  @IsOptional() @IsInt() @Min(0) estimatedUserCount?: number;
}
