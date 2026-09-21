import { IsArray, IsObject, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class RiderAppEnrollDto {
  @IsString() @Matches(/^(?:[6-9]\d{9}|0[6-9]\d{9}|\+91[6-9]\d{9})$/)
  phone!: string;
  @IsString() @Matches(/^[a-z0-9-]+$/)
  companyCode!: string;
}

export class SaveRiderAppStepDto {
  @IsUUID() stepId!: string;
  @IsObject() values!: Record<string, unknown>;
  @IsOptional() @IsArray() skippedFeatureCodes?: string[];
}
