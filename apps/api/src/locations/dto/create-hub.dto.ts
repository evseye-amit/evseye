import { IsString, Matches, MaxLength } from 'class-validator';

export class CreateHubDto {
  @IsString() @MaxLength(100) name!: string;
  @IsString() @Matches(/^[A-Z0-9_-]+$/) @MaxLength(30) code!: string;
}
