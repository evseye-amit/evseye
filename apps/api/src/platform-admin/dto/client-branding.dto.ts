import { IsEmail, IsOptional, IsString, MaxLength, Matches } from 'class-validator';

const phone = /^\+?[1-9]\d{7,14}$/;

export class UpdateClientBrandingDto {
  @IsOptional() @IsEmail() @MaxLength(180) supportEmail?: string;
  @IsOptional() @IsString() @Matches(phone) supportPhone?: string;
}
