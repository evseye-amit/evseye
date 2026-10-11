import { UserRole } from '@prisma/client';
import { IsEnum, IsString, Length } from 'class-validator';

export class PreLoginQuery {
  @IsString() @Length(1, 80) companyCode!: string;
  @IsString() @Length(1, 40) appCode!: string;
  @IsEnum(UserRole) role!: UserRole;
}
