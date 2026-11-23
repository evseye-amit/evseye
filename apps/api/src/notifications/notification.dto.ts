import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsDateString,
  ValidateIf,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const audiences = [
  'ALL_USERS',
  'ALL_RIDERS',
  'ALL_EMPLOYEES',
  'ALL_TEAM_LEADERS',
  'FILTERED',
  'ALL_FLEET_MANAGERS',
  'PHONE_NUMBERS',
] as const;
export type NotificationAudience = (typeof audiences)[number];
export class RegisterPushDeviceDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  installationCredential?: string;
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(['NOT_DETERMINED', 'DENIED', 'AUTHORIZED', 'PROVISIONAL'])
  permission?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_.-]+$/)
  @MaxLength(255)
  applicationId?: string;
  @IsUUID() installationId!: string;
  @IsIn(['RIDER_APP', 'FLEET_MANAGER_APP', 'TEAM_LEADER_APP']) appCode!: string;
  @IsIn(['ANDROID', 'IOS']) platform!: string;
  @IsString() @Matches(/^\S+$/) @MaxLength(4096) token!: string;
}
export class NotificationAudienceDto {
  @IsOptional()
  @IsIn(['RIDER', 'FLEET_MANAGER', 'TEAM_LEADER', 'ADMIN'])
  application?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ArrayUnique()
  @IsIn(
    [
      'RIDER',
      'FLEET_MANAGER',
      'TEAM_LEAD',
      'CLIENT_ADMIN',
      'KYC_OPERATOR',
      'ADVISOR',
      'QC_MANAGER',
    ],
    { each: true },
  )
  roles?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  hubIds?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  cities?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  fleetIds?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  vehicleTypeIds?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  oemIds?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  selectedUserIds?: string[];
  @IsIn(audiences) audience!: NotificationAudience;
  @IsOptional() @IsString() @MaxLength(50000) phoneNumbers?: string;
}
export class SendNotificationDto extends NotificationAudienceDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsDateString({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  scheduledFor?: string;

  @IsOptional()
  @IsString()
  @Matches(/^PG[0-9]{2}_[A-Z0-9_]+$/)
  @MaxLength(100)
  categoryCode?: string;
  @IsOptional() @IsIn(['GENERAL', 'OPERATIONAL']) visibilityPolicy?: string;
  @IsOptional() @IsDateString() visibilityExpiresAt?: string;
  @IsString() @Matches(/\S/) @MaxLength(150) title!: string;
  @IsString() @Matches(/\S/) @MaxLength(2000) body!: string;
  @IsOptional() @IsObject() data?: Record<string, string>;
}
export class NotificationScopeDto {
  @IsOptional()
  @IsIn(['RIDER', 'FLEET_MANAGER', 'TEAM_LEADER', 'ADMIN'])
  application?: string;
}
export class NotificationPageDto extends NotificationScopeDto {
  @IsOptional() @IsString() @MaxLength(300) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
export class MarkAllReadDto extends NotificationScopeDto {
  @IsOptional() @IsUUID() throughId?: string;
}
export class RetryNotificationDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  deliveryIds?: string[];
}

export class NotificationTestDevicesDto {
  @IsString() @Matches(/^\+?[0-9 ]{10,16}$/) phone!: string;
  @IsIn(['RIDER', 'FLEET_MANAGER', 'TEAM_LEADER']) application!: string;
}
export class TestNotificationDto {
  @IsUUID() deviceId!: string;
  @IsIn(['RIDER', 'FLEET_MANAGER', 'TEAM_LEADER']) application!: string;
  @IsString()
  @Matches(/^PG[0-9]{2}_[A-Z0-9_]+$/)
  @MaxLength(100)
  categoryCode!: string;
  @IsString() @Matches(/\S/) @MaxLength(143) title!: string;
  @IsString() @Matches(/\S/) @MaxLength(2000) body!: string;
}
