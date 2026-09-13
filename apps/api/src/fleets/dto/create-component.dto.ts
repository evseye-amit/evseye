import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
export class CreateBatteryDto {
  @IsString() @MaxLength(80) serialNumber!: string;
  @IsOptional() @IsString() @MaxLength(80) batteryType?: string;
  @IsOptional() @IsInt() @Min(1) capacityWh?: number;
  @IsOptional() @IsString() @MaxLength(80) manufacturer?: string;
}
export class CreateControllerDto {
  @IsString() @MaxLength(80) serialNumber!: string;
  @IsOptional() @IsString() @MaxLength(80) manufacturer?: string;
}
