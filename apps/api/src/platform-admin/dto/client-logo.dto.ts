import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ClientLogoUploadDto {
  @IsIn(['image/png', 'image/jpeg', 'image/webp']) mimeType!: string;
  @IsInt() @Min(1) @Max(2 * 1024 * 1024) sizeBytes!: number;
  @IsOptional() @IsString() @MaxLength(500) approvalEmailReference?: string;
}

export class CompleteClientLogoDto {
  @IsString() @MaxLength(250) objectKey!: string;
  @IsOptional() @IsString() @MaxLength(500) approvalEmailReference?: string;
}
