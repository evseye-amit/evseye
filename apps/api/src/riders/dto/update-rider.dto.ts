import { IsObject } from 'class-validator';

export class UpdateRiderDto {
  @IsObject()
  values!: Record<string, unknown>;
}
