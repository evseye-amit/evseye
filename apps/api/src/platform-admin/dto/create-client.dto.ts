import { IsString, Matches, MaxLength } from 'class-validator';

export class CreateClientDto {
  @IsString() @MaxLength(120) name!: string;
  @IsString() @Matches(/^[a-z0-9-]+$/) @MaxLength(80) slug!: string;
  @IsString() @MaxLength(120) adminName!: string;
  @IsString() @Matches(/^\+?[1-9]\d{7,14}$/) adminMobile!: string;
}
