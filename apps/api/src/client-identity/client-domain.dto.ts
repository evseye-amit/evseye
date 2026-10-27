import { IsString, MaxLength } from 'class-validator';

export class CreateClientDomainDto {
  @IsString() @MaxLength(253) hostname!: string;
}
