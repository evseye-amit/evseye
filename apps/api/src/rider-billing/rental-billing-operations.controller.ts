import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { IsISO8601, Matches } from 'class-validator';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ClientContextService } from '../auth/client-context.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { RentalBillingOperations } from './rental-billing-operations.service.js';
class RecoveryApproval {
  @IsISO8601() periodStart!: string;
  @Matches(/^[a-f0-9]{64}$/) fingerprint!: string;
}
@Controller('client/rental-billing')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN)
export class RentalBillingOperationsController {
  constructor(
    private readonly service: RentalBillingOperations,
    private readonly clients: ClientContextService,
  ) {}
  @Get() async audit(
    @CurrentUser() user: AuthUser,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
  ) {
    if (page < 1 || page > 100000)
      throw new BadRequestException('INVALID_PAGE');
    return {
      data: await this.service.audit(this.clients.requireClientId(user), page),
    };
  }
  @Get('schedules/:id/preview') async preview(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return {
      data: await this.service.preview(this.clients.requireClientId(user), id),
    };
  }
  @Post('schedules/:id/approve-recovery') async approve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: RecoveryApproval,
  ) {
    return {
      data: await this.service.approveRecovery(
        this.clients.requireClientId(user),
        id,
        user.id,
        body.periodStart,
        body.fingerprint,
      ),
    };
  }
  @Post('schedules/:id/retry') async retry(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return {
      data: await this.service.retry(
        this.clients.requireClientId(user),
        id,
        user.id,
      ),
    };
  }
  @Post('riders/:id/enable-collection') async enable(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return {
      data: await this.service.enableCollection(
        this.clients.requireClientId(user),
        id,
        user.id,
      ),
    };
  }
  @Post('agreements/:id/repair-schedule') async repair(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return {
      data: await this.service.repairSchedule(
        this.clients.requireClientId(user),
        id,
        user.id,
      ),
    };
  }
  @Post('riders/:id/collect') async collect(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return {
      data: await this.service.collect(
        this.clients.requireClientId(user),
        id,
        user.id,
      ),
    };
  }
}
