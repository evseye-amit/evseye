import 'reflect-metadata';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
export const paymentSources = ['DEPLOYMENT', 'COLLECTION', 'AUTOPAY', 'RECEIVED'] as const;
export class PaymentTransactionsQuery {
  @IsOptional() @IsIn(['createdAt','riderName','mobile','amount','status','reference','source','method','purpose']) sortBy: string = 'createdAt';
  @IsOptional() @IsIn(['asc','desc']) sortDirection: string = 'desc';
  @IsOptional() @IsIn(paymentSources) source?: typeof paymentSources[number];
  @IsOptional() @IsString() @MaxLength(40) status?: string;
  @IsOptional() @IsString() @MaxLength(150) search?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
export class PaymentReviewDto {
  @Type(() => Number) @IsInt() @Min(0) expectedVersion!: number;
}
export class RejectPaymentDto extends PaymentReviewDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}
export class PaymentReceiptUploadDto {
  @IsString() @MaxLength(255) @MinLength(1) fileName!: string;
  @IsIn(['image/jpeg', 'image/png', 'image/webp']) mimeType!: 'image/jpeg' | 'image/png' | 'image/webp';
  @IsInt() @Min(1) @Max(5 * 1024 * 1024) sizeBytes!: number;
}

export class VerifyPaymentDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) expectedVersion?: number;
}
