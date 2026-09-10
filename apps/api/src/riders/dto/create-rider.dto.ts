import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateRiderDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsString()
  @Matches(/^\+?[1-9]\d{7,14}$/)
  mobile!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;
}
