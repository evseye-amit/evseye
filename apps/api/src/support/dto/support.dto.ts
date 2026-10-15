import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateSupportTicketDto {
  @IsString() @MaxLength(160) subject!: string;
  @IsString() @MaxLength(10000) message!: string;
}

export class CreateSupportReplyDto {
  @IsString() @MaxLength(10000) message!: string;
}

export class ListSupportTicketsDto {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @IsIn(['OPEN', 'IN_PROGRESS', 'RESOLVED']) status?: string;
  @IsOptional() @IsUUID() hubId?: string;
}

export class UpdateSupportStatusDto {
  @IsIn(['OPEN', 'IN_PROGRESS', 'RESOLVED']) status!: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
}

export class SupportAttachmentIntentDto {
  @IsString() @MaxLength(80) photoType!: string;
  @IsString() @IsIn(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) mimeType!: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
  @IsString() @MaxLength(255) fileName!: string;
  @IsInt() @Min(1) @Max(5 * 1024 * 1024) sizeBytes!: number;
}
