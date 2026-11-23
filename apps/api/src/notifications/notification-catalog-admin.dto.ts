import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { notificationApplications } from './notification-catalog.service.js';
export class CatalogCategoryFieldsDto {
  @IsString() @Matches(/\S/) @MaxLength(150) name!: string;
  @IsString() @MaxLength(1000) description!: string;
  @IsBoolean() isActive!: boolean;
  @IsArray()
  @ArrayMaxSize(4)
  @ArrayUnique()
  @IsIn(notificationApplications, { each: true })
  applications!: string[];
}
export class CreateCatalogCategoryDto extends CatalogCategoryFieldsDto {
  @IsString() @Matches(/^PG(0[1-9]|1[0-2])$/) parentCode!: string;
  @IsString()
  @Matches(/^PG(0[1-9]|1[0-2])_[A-Z0-9_]+$/)
  @MaxLength(100)
  code!: string;
}
export class UpdateCatalogCategoryDto extends CatalogCategoryFieldsDto {
  @IsDateString() expectedUpdatedAt!: string;
}
export class UpdateCatalogGroupDto {
  @IsDateString() expectedUpdatedAt!: string;
  @IsBoolean() isActive!: boolean;
}
