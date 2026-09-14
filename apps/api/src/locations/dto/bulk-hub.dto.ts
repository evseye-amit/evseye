import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CreateHubDto } from './create-hub.dto.js';

export class BulkHubDto {
  @IsString() @MaxLength(255) filename!: string;
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CreateHubDto)
  rows!: CreateHubDto[];
}
