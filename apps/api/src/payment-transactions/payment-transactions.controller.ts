import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ClientContextService } from '../auth/client-context.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { PaymentTransactionsService } from './payment-transactions.service.js';
import { PaymentReceiptUploadDto, PaymentReviewDto, PaymentTransactionsQuery, RejectPaymentDto } from './payment-transactions.dto.js';

@Controller('client/payment-transactions')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN)
export class ClientPaymentTransactionsController {
  constructor(private readonly service: PaymentTransactionsService, private readonly clients: ClientContextService) {}
  @Get() list(@CurrentUser() user: AuthUser, @Query() query: PaymentTransactionsQuery) { return this.service.list(this.clients.requireClientId(user), user, query).then(data => ({ data })); }
  @Get(':source/:id') detail(@CurrentUser() user: AuthUser, @Param('source') source: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.detail(this.clients.requireClientId(user), user, source, id).then(data => ({ data })); }
  @Post(':source/:id/approve') approve(@CurrentUser() user: AuthUser, @Param('source') source: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PaymentReviewDto) {
    return this.service.approve(this.clients.requireClientId(user), user, source, id, dto.expectedVersion).then(data => ({ data }));
  }
  @Post(':source/:id/reject') reject(@CurrentUser() user: AuthUser, @Param('source') source: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectPaymentDto) {
    return this.service.reject(this.clients.requireClientId(user), user, source, id, dto.expectedVersion, dto.reason).then(data => ({ data }));
  }
  @Get(':source/:id/receipts/:photoId/download-url') download(@CurrentUser() user: AuthUser, @Param('source') source: string, @Param('id', ParseUUIDPipe) id: string, @Param('photoId', ParseUUIDPipe) photoId: string) {
    return this.service.download(this.clients.requireClientId(user), user, source, id, photoId).then(data => ({ data }));
  }
}

@Controller('rider-app/billing/payment-transactions')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.RIDER)
export class RiderPaymentTransactionsController {
  constructor(private readonly service: PaymentTransactionsService, private readonly clients: ClientContextService) {}
  @Get() list(@CurrentUser() user: AuthUser, @Query() query: PaymentTransactionsQuery) { return this.service.list(this.clients.requireClientId(user), user, query).then(data => ({ data })); }
  @Get(':source/:id') @Roles(UserRole.RIDER, UserRole.FLEET_MANAGER)
  detail(@CurrentUser() user: AuthUser, @Param('source') source: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.detail(this.clients.requireClientId(user), user, source, id).then(data => ({ data })); }
  @Post(':source/:id/receipts/upload-intent') upload(@CurrentUser() user: AuthUser, @Param('source') source: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PaymentReceiptUploadDto) {
    return this.service.upload(this.clients.requireClientId(user), user, source, id, dto).then(data => ({ data }));
  }
  @Post(':source/:id/receipts/:photoId/complete') complete(@CurrentUser() user: AuthUser, @Param('source') source: string, @Param('id', ParseUUIDPipe) id: string, @Param('photoId', ParseUUIDPipe) photoId: string) {
    return this.service.complete(this.clients.requireClientId(user), user, source, id, photoId).then(data => ({ data }));
  }
  @Get(':source/:id/receipts/:photoId/download-url') @Roles(UserRole.RIDER, UserRole.FLEET_MANAGER)
  download(@CurrentUser() user: AuthUser, @Param('source') source: string, @Param('id', ParseUUIDPipe) id: string, @Param('photoId', ParseUUIDPipe) photoId: string) {
    return this.service.download(this.clients.requireClientId(user), user, source, id, photoId).then(data => ({ data }));
  }
}
