import { IsIn, IsString, Matches } from 'class-validator';

export class RequestDeallocationOtpDto {
  @IsString()
  @Matches(/^\+?[1-9]\d{7,14}$/)
  phone!: string;

  @IsIn(['RIDER', 'OPERATOR'])
  party!: 'RIDER' | 'OPERATOR';
}
