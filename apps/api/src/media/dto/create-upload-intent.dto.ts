import {
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateUploadIntentDto {
  @IsIn([
    'RIDER',
    'FLEET',
    'BATTERY',
    'CONTROLLER',
    'IOT_DEVICE',
    'INSPECTION',
    'RIDER_ONBOARDING',
  ])
  entityType!:
    | 'RIDER'
    | 'FLEET'
    | 'BATTERY'
    | 'CONTROLLER'
    | 'IOT_DEVICE'
    | 'INSPECTION'
    | 'RIDER_ONBOARDING';

  @IsUUID()
  entityId!: string;

  @IsString()
  @MaxLength(80)
  photoType!: string;

  @IsString()
  @IsIn(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  mimeType!: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsInt()
  @Min(1)
  @Max(5 * 1024 * 1024)
  sizeBytes!: number;
}
