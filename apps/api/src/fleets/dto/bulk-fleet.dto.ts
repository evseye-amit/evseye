import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsObject,
  IsString,
  MaxLength,
} from 'class-validator';

export class BulkFleetDto {
  @IsString() @MaxLength(255) filename!: string;
  @IsArray()
  @ArrayMaxSize(1000)
  @IsObject({ each: true })
  @Type(() => Object)
  rows!: Array<Record<string, unknown>>;
}
