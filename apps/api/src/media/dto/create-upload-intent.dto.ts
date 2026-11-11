import {
  IsIn,
  IsInt,
  IsOptional,
  IsEnum,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PhotoSubjectType, PhotoType, PhotoWorkflowType } from '@prisma/client';

export class CreateUploadIntentDto {
  @IsOptional() @IsEnum(PhotoWorkflowType)
  workFlowType?: PhotoWorkflowType;

  @IsOptional() @IsEnum(PhotoSubjectType)
  subjectType?: PhotoSubjectType;

  @IsUUID()
  entityId!: string;

  @IsString()
  @IsEnum(PhotoType)
  photoType!: PhotoType;

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
