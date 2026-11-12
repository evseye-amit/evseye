import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';

export class ClientFeatureRevisionItemDto {
  @IsString() featureId!: string;
  @IsBoolean() enabled!: boolean;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsObject() configuration?: Record<string, unknown> | null;
}

export class SaveClientFeatureDraftDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ClientFeatureRevisionItemDto)
  snapshot!: ClientFeatureRevisionItemDto[];
}
