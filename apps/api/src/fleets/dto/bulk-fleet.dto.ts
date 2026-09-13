import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CreateFleetDto } from './create-fleet.dto.js';

export class BulkFleetDto {
  @IsString() @MaxLength(255) filename!: string;
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CreateFleetDto)
  rows!: CreateFleetDto[];
}
