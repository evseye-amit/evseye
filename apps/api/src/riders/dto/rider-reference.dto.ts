import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class ListRiderReferencesDto {
  @IsOptional() @IsString() riderId?: string;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsIn(['PENDING', 'APPROVED', 'REJECTED']) status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  @IsOptional() @IsString() @MaxLength(200) search?: string;
}

export class RejectRiderReferenceDto {
  @IsString() @Matches(/\S/, { message: 'A rejection reason is required.' }) @MaxLength(1000)
  rejectionReason!: string;
}
