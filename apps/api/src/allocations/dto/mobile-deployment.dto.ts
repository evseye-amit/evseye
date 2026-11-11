import { ArrayMaxSize, ArrayUnique, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class PdiItemDto {
  @IsString() code!: string;
  @IsString() label!: string;
  @IsBoolean() mandatory!: boolean;
}
export class SubmitPdiDto {
  @ValidateIf((_, value) => value !== undefined) @IsUUID() clientWorkPartnerId?: string;
  @ValidateIf((_, value) => value !== undefined) @IsString() @MaxLength(150) workPartnerName?: string;
  @IsArray() @ArrayMinSize(1) @ArrayUnique((item: PdiItemDto) => item.code) @ValidateNested({ each: true }) @Type(() => PdiItemDto)
  checklist!: PdiItemDto[];
}
export class RiderPdiItemDto {
  @IsString() code!: string;
  @IsBoolean() accepted!: boolean;
  @IsOptional() @IsString() remarksText?: string;
  @IsOptional() @IsUUID() voiceMediaId?: string;
}
export class AcceptPdiDto { @IsArray() @ValidateNested({ each: true }) @Type(() => RiderPdiItemDto) items!: RiderPdiItemDto[]; }

export class TrainingViewedDto {
  @IsString() contentCode!: string;
}

export class PairDeviceDto {
  @IsString() @MaxLength(100) deviceNumber!: string;
}

export class BypassPairingDto {
  @IsString() @MaxLength(1000) remarks!: string;
}

/** Pricing is always generated from the rider's accepted rental agreement. */
export class AskPaymentDto {}

export class SubmitPaymentReferenceDto {
  @IsString() @Matches(/\S/) @MaxLength(80) provider!: string;
  @IsString() @Matches(/\S/) @MaxLength(160) providerReference!: string;
  @ValidateIf((_, value) => value !== undefined) @IsArray() @ArrayMaxSize(20) @ArrayUnique() @IsUUID(undefined, { each: true })
  receiptPhotoIds?: string[];
}

export class FleetManagerAllocateDto {
  @IsUUID() riderId!: string;
  @IsUUID() fleetId!: string;
}

export class PdiVoiceUploadIntentDto {
  @IsString() @Matches(/^[A-Z0-9_]{1,60}$/) itemCode!: string;
  @IsString() @IsIn(['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg']) mimeType!: 'audio/mpeg' | 'audio/mp4' | 'audio/wav' | 'audio/ogg';
  @IsString() @MaxLength(255) fileName!: string;
  @IsInt() @Min(1) @Max(5 * 1024 * 1024) sizeBytes!: number;
}
