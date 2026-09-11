import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class OnboardingConfigStepDto {
  @IsString() @MaxLength(64) stepKey!: string;
  @IsBoolean() enabled!: boolean;
  @IsBoolean() mandatory!: boolean;
  @IsBoolean() blocking!: boolean;
  @IsInt() @Min(1) sequenceNo!: number;
  @IsString() verificationMode!: string;
  @IsOptional() @IsInt() @Min(1) slaHours?: number;
  @IsArray() @IsString({ each: true }) dependsOn!: string[];
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  applicableModels?: string[];
  @IsObject() params!: Record<string, unknown>;
}

export class UpsertOnboardingConfigStepsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OnboardingConfigStepDto)
  steps!: OnboardingConfigStepDto[];
}
