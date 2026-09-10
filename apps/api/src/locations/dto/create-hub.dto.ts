import { IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class CreateHubDto {
  @IsUUID() zoneId!: string;
  @IsString() @MaxLength(100) name!: string;
  @IsString() @Matches(/^[A-Z0-9_-]+$/) @MaxLength(30) code!: string;
}
