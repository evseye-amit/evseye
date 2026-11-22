import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class AppIdentityDto {
  @IsIn(['RIDER_APP', 'FLEET_MANAGER_APP']) appCode!:
    'RIDER_APP' | 'FLEET_MANAGER_APP';
  @IsIn(['ANDROID', 'IOS']) platform!: 'ANDROID' | 'IOS';
  @IsString()
  @Length(3, 200)
  @Matches(/^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+$/)
  applicationId!: string;
  @IsIn(['PRODUCTION', 'TEST']) channel!: 'PRODUCTION' | 'TEST';
}
export class AppReleaseDto {
  @Matches(/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/)
  version!: string;
  @Matches(/^(0|[1-9]\d{0,9})(?:\.(0|[1-9]\d{0,9})){0,2}$/) build!: string;
}
export class AppCheckDto extends AppIdentityDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => AppReleaseDto)
  installed!: AppReleaseDto;
}
export class PublicAppCheckDto extends AppCheckDto {
  @IsString() @Length(1, 80) @Matches(/^[A-Za-z0-9_-]+$/) companyCode!: string;
}
export class AppPolicySettingsDto {
  @IsBoolean() enabled!: boolean;
  @IsDefined()
  @ValidateNested()
  @Type(() => AppReleaseDto)
  minimum!: AppReleaseDto;
  @IsDefined()
  @ValidateNested()
  @Type(() => AppReleaseDto)
  latest!: AppReleaseDto;
  @IsString() @Length(1, 2048) storeUrl!: string;
  @IsString() @Length(1, 120) title!: string;
  @IsString() @Length(1, 2000) message!: string;
  @IsString() @Length(0, 5000) releaseNotes!: string;
}
export class SaveAppPolicyDto extends AppIdentityDto {
  @IsInt() @Min(0) @Max(2147483646) expectedRevision!: number;
  @IsDefined()
  @ValidateNested()
  @Type(() => AppPolicySettingsDto)
  settings!: AppPolicySettingsDto;
}
export class PolicyRevisionDto {
  @IsInt() @Min(1) @Max(2147483646) expectedRevision!: number;
}
export class PublishAppPolicyDto extends PolicyRevisionDto {
  @IsBoolean() releaseAvailable!: boolean;
}
export class RestoreAppPolicyDto extends PolicyRevisionDto {
  @IsInt() @Min(1) @Max(2147483646) sourceRevision!: number;
}
export class PreviewAppPolicyDto extends AppCheckDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => AppPolicySettingsDto)
  settings!: AppPolicySettingsDto;
}
