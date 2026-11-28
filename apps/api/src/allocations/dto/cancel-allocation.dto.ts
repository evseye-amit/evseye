import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

export class CancelAllocationDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(3, 1000)
  reason!: string;
}
