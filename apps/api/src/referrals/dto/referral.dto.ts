import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNotEmpty, IsNumberString, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { ReferralAttributionSource, ReferralCampaignStatus, ReferralFraudResult, ReferralFraudType, ReferralLimitPeriod, ReferralMilestoneOperator, ReferralMilestoneType, ReferralRewardStatus, ReferralRewardType, ReferralStatus } from '@prisma/client';

export class CampaignMilestoneDto {
  @IsEnum(ReferralMilestoneType) milestoneType!: ReferralMilestoneType;
  @IsEnum(ReferralMilestoneOperator) operator!: ReferralMilestoneOperator;
  @IsNumberString() targetValue!: string;
  @IsInt() @Min(1) sequence!: number;
  @IsOptional() @IsBoolean() mandatory?: boolean;
}

export class CampaignDto {
  @IsString() @Matches(/^[A-Z0-9_]{3,48}$/) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsString() @MaxLength(160) displayTitle?: string;
  @IsOptional() @IsString() @MaxLength(1000) displayDescription?: string;
  @IsOptional() @IsString() @MaxLength(1000) shareMessageTemplate?: string;
  @IsString() @IsNotEmpty() termsAndConditions!: string;
  @IsDateString() startAt!: string;
  @IsDateString() endAt!: string;
  @IsInt() @Min(1) registrationValidityDays!: number;
  @IsInt() @Min(1) qualificationValidityDays!: number;
  @IsOptional() @IsEnum(ReferralRewardType) referrerRewardType?: ReferralRewardType;
  @IsNumberString() referrerRewardValue!: string;
  @IsOptional() @IsEnum(ReferralRewardType) refereeRewardType?: ReferralRewardType;
  @IsNumberString() refereeRewardValue!: string;
  @IsOptional() @IsInt() @Min(1) maxReferralsPerRider?: number;
  @IsOptional() @IsEnum(ReferralLimitPeriod) referralLimitPeriod?: ReferralLimitPeriod;
  @IsOptional() @IsInt() @Min(1) maxQualifiedReferralsPerRider?: number;
  @IsOptional() @IsNumberString() maxRewardPerRider?: string;
  @IsOptional() @IsNumberString() campaignBudget?: string;
  @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => CampaignMilestoneDto)
  milestones!: CampaignMilestoneDto[];
}

export class ListCampaignsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsOptional() @IsEnum(ReferralCampaignStatus) status?: ReferralCampaignStatus;
  @IsOptional() @IsString() search?: string;
}

export class ListReferralsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsOptional() @IsEnum(ReferralStatus) status?: ReferralStatus;
  @IsOptional() @IsString() campaignId?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsEnum(ReferralFraudResult) fraudResult?: ReferralFraudResult;
  @IsOptional() @IsEnum(ReferralRewardStatus) rewardStatus?: ReferralRewardStatus;
}

export class ListRewardsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsOptional() @IsEnum(ReferralRewardStatus) status?: ReferralRewardStatus;
  @IsOptional() @IsString() campaignId?: string;
}

export class ListReferralNotificationsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class AttributionDto {
  @IsString() @Matches(/^EVS-[A-Z2-9]{8}$/i) referralCode!: string;
  @IsOptional() @IsEnum(ReferralAttributionSource) source?: ReferralAttributionSource;
  @IsOptional() @IsString() inviteToken?: string;
}

export class ReasonDto { @IsString() @IsNotEmpty() @MaxLength(1000) reason!: string; }
export class PayoutDto {
  @IsString() @IsNotEmpty() @MaxLength(120) paymentReference!: string;
  @IsString() @IsNotEmpty() @MaxLength(40) paymentMethod!: string;
}

export class ActivityEventDto {
  @IsString() @IsNotEmpty() sourceEventId!: string;
  @IsString() @IsNotEmpty() riderId!: string;
  @IsEnum(ReferralMilestoneType) milestoneType!: ReferralMilestoneType;
  @IsNumberString() quantity!: string;
  @IsDateString() occurredAt!: string;
}

export class DuplicateCampaignDto { @IsString() @Matches(/^[A-Z0-9_]{3,48}$/) code!: string; }
export class PublicReferralQueryDto { @IsString() @Matches(/^EVS-[A-Z2-9]{8}$/i) code!: string; }
export class FraudReviewDto extends ReasonDto { @IsEnum(ReferralFraudType) checkType!: ReferralFraudType; }
