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
} from 'class-validator';
export class UpdateBrandingDto {
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
export interface PublicClientContext {
  client: { displayName: string } | null;
  branding: {
    logoUrl: string | null;
    faviconUrl: string | null;
    supportEmail: string | null;
    supportPhone: string | null;
  };
}
