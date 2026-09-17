import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
export class UpdateBrandingDto {
  @ValidateIf((_object, value) => value !== undefined) @Matches(/^#[0-9a-fA-F]{6}$/) primaryColor?: string;
  @ValidateIf((_object, value) => value !== undefined) @Matches(/^#[0-9a-fA-F]{6}$/) secondaryColor?: string;
  @ValidateIf((_object, value) => value !== undefined) @Matches(/^#[0-9a-fA-F]{6}$/) accentColor?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  @Matches(/^[^<>]*$/)
  loginTitle?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(240)
  @Matches(/^[^<>]*$/)
  loginSubtitle?: string;
  @IsOptional() @IsEmail() @MaxLength(254) supportEmail?: string | null;
  @IsOptional() @Matches(/^[+0-9 ()-]{6,30}$/) supportPhone?: string | null;
}
export class BrandingUploadDto {
  @IsIn(['logo', 'favicon']) kind!: 'logo' | 'favicon';
  @IsIn(['image/png', 'image/jpeg', 'image/webp']) mimeType!: string;
  @IsInt() @Min(1) @Max(2 * 1024 * 1024) sizeBytes!: number;
}
export class CompleteBrandingUploadDto {
  @IsIn(['logo', 'favicon']) kind!: 'logo' | 'favicon';
  @IsString() @MaxLength(250) objectKey!: string;
}
export class CreateClientDomainDto {
  @IsString() @MaxLength(253) hostname!: string;
}
export interface PublicClientContext {
  client: { displayName: string } | null;
  branding: {
    logoUrl: string | null;
    faviconUrl: string | null;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    loginTitle: string;
    loginSubtitle: string;
    supportEmail: string | null;
    supportPhone: string | null;
  };
}
