import { IsString, MaxLength } from 'class-validator';

export class RejectClientDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}
