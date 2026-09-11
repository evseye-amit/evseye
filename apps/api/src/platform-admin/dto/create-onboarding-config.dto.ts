import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateOnboardingConfigDto {
  @IsOptional() @IsInt() @Min(1) cloneFromVersion?: number;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
