import { IsEnum, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';
import { WorkPartnerCategory } from '@prisma/client';

export class WorkPartnerDetailsDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(WorkPartnerCategory)
  category?: WorkPartnerCategory;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(250)
  @Matches(/^\/logos\/work-partners\/[A-Za-z0-9_-]+\.(svg|png|jpe?g|webp)$/i)
  logo?: string | null;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(500)
  workType?: string | null;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(500)
  website?: string | null;
}

const WORK_PARTNER_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type WorkPartnerStatus = (typeof WORK_PARTNER_STATUSES)[number];

export class CreateWorkPartnerDto extends WorkPartnerDetailsDto {
  @IsString()
  @Matches(/^\s*[A-Za-z0-9_-]+\s*$/)
  @MaxLength(50)
  code!: string;

  @IsString()
  @MaxLength(150)
  name!: string;

  @IsString()
  @MaxLength(160)
  legalName!: string;

  @IsOptional()
  @IsIn(WORK_PARTNER_STATUSES)
  status?: WorkPartnerStatus;
}

export class UpdateWorkPartnerDto extends WorkPartnerDetailsDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(150)
  name?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(160)
  legalName?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsIn(WORK_PARTNER_STATUSES)
  status?: WorkPartnerStatus;
}

export class CopyWorkPartnerDto {
  @IsString()
  @IsUUID()
  masterId!: string;
}
