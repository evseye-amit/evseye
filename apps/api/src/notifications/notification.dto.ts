import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
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
  'ALL_FLEET_MANAGERS',
  'PHONE_NUMBERS',
] as const;
export type NotificationAudience = (typeof audiences)[number];
export class RegisterPushDeviceDto {
  @IsUUID() installationId!: string;
  @IsIn(['RIDER_APP', 'FLEET_MANAGER_APP']) appCode!: string;
  @IsIn(['ANDROID', 'IOS']) platform!: string;
  @IsString() @Matches(/^\S+$/) @MaxLength(4096) token!: string;
}
export class NotificationAudienceDto {
  @IsIn(audiences) audience!: NotificationAudience;
  @IsOptional() @IsString() @MaxLength(50000) phoneNumbers?: string;
}
export class SendNotificationDto extends NotificationAudienceDto {
  @IsString() @Matches(/\S/) @MaxLength(150) title!: string;
  @IsString() @Matches(/\S/) @MaxLength(2000) body!: string;
  @IsOptional() @IsObject() data?: Record<string, string>;
}
export class NotificationPageDto {
  @IsOptional() @IsString() @MaxLength(300) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
export class MarkAllReadDto {
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
