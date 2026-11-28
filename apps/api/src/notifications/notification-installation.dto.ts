import {
  IsIn,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
export const notificationPermissions = [
  'NOT_DETERMINED',
  'DENIED',
  'AUTHORIZED',
  'PROVISIONAL',
] as const;
export class UpdateInstallationDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Matches(/^\S+$/)
  @MaxLength(4096)
  token?: string;
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Matches(/^\S+$/)
  @MaxLength(255)
  firebaseInstallationId?: string;
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(notificationPermissions)
  permission?: string;
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(['REGISTRATION_STARTED', 'REGISTRATION_INCOMPLETE'])
  onboardingState?: string;
}
export class EnrollInstallationDto extends UpdateInstallationDto {
  @IsUUID() bindingId!: string;
}

export class ClaimInstallationDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(notificationPermissions)
  permission?: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) installationCredential!: string;
}
