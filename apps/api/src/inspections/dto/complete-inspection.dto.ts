import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CompleteInspectionDto {
  @IsOptional()
  @IsBoolean()
  safeForReuse?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  unsafeReason?: string;
}
