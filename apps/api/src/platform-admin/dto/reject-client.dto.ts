import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const CLIENT_ONBOARDING_REJECTION_SECTIONS = [
  'BUSINESS_DETAILS', 'CONTACTS_ADDRESS', 'OPERATIONS', 'PACKAGE_BILLING',
  'AGREEMENT', 'DOCUMENTS', 'HUBS', 'FLEET_MANAGERS', 'FLEETS', 'RIDERS', 'GENERAL',
] as const;

export class RejectClientDto {
  @IsString()
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsIn(CLIENT_ONBOARDING_REJECTION_SECTIONS)
  section?: (typeof CLIENT_ONBOARDING_REJECTION_SECTIONS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(80)
  reasonCode?: string;
}
