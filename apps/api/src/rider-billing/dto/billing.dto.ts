import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const money = /^\d+(?:\.\d{1,2})?$/;
const quantity = /^\d+(?:\.\d{1,4})?$/;
const code = /^[A-Z][A-Z0-9_]{1,59}$/;
const date = /^\d{4}-\d{2}-\d{2}$/;

export class CreateRiderChargeDto {
  @IsString() @Matches(code) chargeType!: string;
  @IsString() @MaxLength(300) description!: string;
  @IsString() @Matches(quantity) quantity!: string;
  @IsString() @Matches(money) unitAmount!: string;
  @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsString() @Matches(date) effectiveDate?: string;
  @IsOptional() @IsString() @MaxLength(60) referenceType?: string;
  @IsOptional() @IsString() @MaxLength(120) referenceId?: string;
}

export class CreateRiderCreditDto {
  @IsString() @Matches(code) creditType!: string;
  @IsString() @MaxLength(300) description!: string;
  @IsString() @Matches(money) amount!: string;
  @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsString() @Matches(date) effectiveDate?: string;
  @IsOptional() @IsString() @MaxLength(60) referenceType?: string;
  @IsOptional() @IsString() @MaxLength(120) referenceId?: string;
}

export class FinalizeRiderInvoiceDto {
  @IsString() @Matches(date) billingPeriodStart!: string;
  @IsString() @Matches(date) billingPeriodEnd!: string;
  @IsString() @Matches(date) dueDate!: string;
}
