import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ClientContextService } from '../auth/client-context.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { AttendanceService } from './attendance.service.js';
import {
  AddAttendancePeriodDto,
  CorrectAttendancePeriodDto,
  ListAttendanceDto,
} from './dto/attendance.dto.js';

@Controller('attendance/admin')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN)
export class AttendanceAdminController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly clients: ClientContextService,
  ) {}

  @Post('users/:userId/check-in')
  async checkIn(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
  ) {
    return {
      data: await this.attendance.adminCheckIn(
        this.clients.requireClientId(user),
        user.id,
        userId,
      ),
    };
  }

  @Post('users/:userId/check-out')
  async checkOut(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
  ) {
    return {
      data: await this.attendance.adminCheckOut(
        this.clients.requireClientId(user),
        user.id,
        userId,
      ),
    };
  }

  @Post('users/:userId/periods')
  async addPeriod(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @Body() dto: AddAttendancePeriodDto,
  ) {
    return {
      data: await this.attendance.addPeriod(
        this.clients.requireClientId(user),
        user.id,
        userId,
        dto,
      ),
    };
  }

  @Patch('periods/:periodId')
  async correctPeriod(
    @CurrentUser() user: AuthUser,
    @Param('periodId') periodId: string,
    @Body() dto: CorrectAttendancePeriodDto,
  ) {
    return {
      data: await this.attendance.correctPeriod(
        this.clients.requireClientId(user),
        user.id,
        periodId,
        dto,
      ),
    };
  }

  @Get('periods')
  async periods(
    @CurrentUser() user: AuthUser,
    @Query() query: ListAttendanceDto,
  ) {
    return {
      data: await this.attendance.listForClient(
        this.clients.requireClientId(user),
        query,
      ),
    };
  }

  @Get('periods/:periodId/history')
  async history(
    @CurrentUser() user: AuthUser,
    @Param('periodId') periodId: string,
  ) {
    return {
      data: await this.attendance.historyForClient(
        this.clients.requireClientId(user),
        periodId,
      ),
    };
  }
}
