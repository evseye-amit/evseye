import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ClientContextService } from '../auth/client-context.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { RiderEarningsQueryDto } from './dto/rider-earnings.dto.js';
import { RiderEarningsService } from './rider-earnings.service.js';

@Controller('riders/:riderId/earnings')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN, UserRole.FLEET_MANAGER)
export class RiderEarningsController {
  constructor(private readonly earnings: RiderEarningsService, private readonly clients: ClientContextService) {}
  @Get()
  async list(@CurrentUser() user: AuthUser, @Param('riderId', ParseUUIDPipe) riderId: string, @Query() query: RiderEarningsQueryDto) {
    return { data: await this.earnings.list(this.clients.requireClientId(user), riderId, query) };
  }
}
