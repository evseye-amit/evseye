import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { PhotoType } from '@prisma/client';

export class RiderDocumentUploadIntentDto {
  @IsString() @Matches(/^[A-Z0-9_]{1,100}$/) fieldCode!: string;
  @IsOptional() @IsIn(Object.values(PhotoType)) photoType?: PhotoType;
  @IsString() @IsIn(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) mimeType!: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
  @IsString() @MaxLength(255) fileName!: string;
  @IsInt() @Min(1) @Max(5 * 1024 * 1024) sizeBytes!: number;
}

export class RejectRiderDocumentDto {
  @IsString() @MaxLength(1000) rejectionReason!: string;
}

export class ListRiderDocumentsDto {
  @IsOptional() @IsIn(['PENDING', 'APPROVED', 'REJECTED']) status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  @IsOptional() @IsString() search?: string;
}
