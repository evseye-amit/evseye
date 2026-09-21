import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class RiderDocumentUploadIntentDto {
  @IsString() @Matches(/^[A-Z0-9_]{1,100}$/) fieldCode!: string;
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
