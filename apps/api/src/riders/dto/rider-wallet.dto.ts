import { Type } from 'class-transformer';
import { WalletTransactionStatus, WalletTransactionType } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
export class RiderWalletTransactionsQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 10;
  @IsOptional() @IsEnum(WalletTransactionType) type?: WalletTransactionType;
  @IsOptional() @IsEnum(WalletTransactionStatus) status?: WalletTransactionStatus;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
}
