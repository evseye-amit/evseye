import { IsIn, IsInt, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreateUploadIntentDto {
  @IsIn(['RIDER', 'FLEET', 'INSPECTION'])
  entityType!: 'RIDER' | 'FLEET' | 'INSPECTION';

  @IsUUID()
  entityId!: string;

  @IsString()
  @MaxLength(80)
  photoType!: string;

  @IsString()
  @IsIn(['image/jpeg', 'image/png', 'image/webp'])
  mimeType!: 'image/jpeg' | 'image/png' | 'image/webp';

  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsInt()
  @Min(1)
  @Max(5 * 1024 * 1024)
  sizeBytes!: number;
}
