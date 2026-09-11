import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class UpsertPhotoRequirementDto {
  @IsBoolean()
  isRequired!: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
