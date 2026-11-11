import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsObject,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class CreateRiderDto {
  @IsObject()
  values!: Record<string, unknown>;
}

export class BulkRiderDto {
  @IsString() @MaxLength(255) filename!: string;
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CreateRiderDto)
  rows!: CreateRiderDto[];
}
