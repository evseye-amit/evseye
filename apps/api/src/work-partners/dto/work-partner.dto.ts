import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';

const WORK_PARTNER_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type WorkPartnerStatus = (typeof WORK_PARTNER_STATUSES)[number];

export class CreateWorkPartnerDto {
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

export class UpdateWorkPartnerDto {
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
