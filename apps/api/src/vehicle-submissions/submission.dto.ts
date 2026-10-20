import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class StartSubmissionDto {
  @IsOptional() @IsUUID() hubId?: string;
}
export class SubmissionPenaltyDto {
  @IsUUID() priceId!: string;
  @IsOptional() @IsInt() @Min(1) configurationVersion?: number;
  @IsOptional() @IsIn(['DAMAGE', 'MISSING_ITEM']) findingType?:
    'DAMAGE' | 'MISSING_ITEM';
  @IsOptional() @IsUUID() findingId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) quantity = 1;
  @IsString() @Matches(/\S/) @MaxLength(1000) details!: string;
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  evidencePhotoIds!: string[];
}
export class MechanicReportDto {
  @IsIn(['AVAILABLE', 'MAINTENANCE', 'BROKEN', 'AWAITING_PARTS']) fleetStatus!: 'AVAILABLE' | 'MAINTENANCE' | 'BROKEN' | 'AWAITING_PARTS';
  @IsIn(['BASIC', 'DEEP']) stage!: 'BASIC' | 'DEEP';
  @IsString() @Matches(/\S/) @MaxLength(150) mechanicName!: string;
  @IsString() @Matches(/\S/) @MaxLength(4000) summary!: string;
  @IsBoolean() safeForReuse!: boolean;
  @IsOptional() @IsString() @MaxLength(500) unsafeReason?: string;
  @IsOptional() @IsBoolean() checksComplete = false;
  @IsArray()
  @ArrayMaxSize(40)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  evidencePhotoIds!: string[];
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => SubmissionPenaltyDto)
  items!: SubmissionPenaltyDto[];
}
export class RequestSubmissionOtpDto {
  @IsOptional() @IsIn(['BOTH', 'RIDER', 'TEAM_LEAD']) party:
    'BOTH' | 'RIDER' | 'TEAM_LEAD' = 'BOTH';
}
export class VerifySubmissionOtpDto {
  @IsIn(['RIDER', 'TEAM_LEAD']) party!: 'RIDER' | 'TEAM_LEAD';
  @IsUUID() otpRequestId!: string;
  @IsString() @Matches(/^\d{6}$/) code!: string;
}
export class ConfirmSubmissionReportDto {
  @IsOptional()
  @IsString()
  @Matches(/\S/)
  @MaxLength(500)
  riderBypassReason?: string;
  @IsOptional()
  @IsString()
  @Matches(/\S/)
  @MaxLength(500)
  teamLeadBypassReason?: string;
}
export class CancelSubmissionReportDto {
  @IsString() @Matches(/\S/) @MaxLength(500) reason!: string;
}
