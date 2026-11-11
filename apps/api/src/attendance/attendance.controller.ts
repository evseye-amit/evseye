import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { AttendanceService } from './attendance.service.js';
import { ListAttendanceDto } from './dto/attendance.dto.js';

@Controller('attendance')
@UseGuards(AccessTokenGuard)
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post('check-in')
  async checkIn(@CurrentUser() user: AuthUser) {
    return { data: await this.attendance.checkIn(user) };
  }

  @Post('check-out')
  async checkOut(@CurrentUser() user: AuthUser) {
    return { data: await this.attendance.checkOut(user) };
  }

  @Get('periods')
  async periods(
    @CurrentUser() user: AuthUser,
    @Query() query: ListAttendanceDto,
  ) {
    return { data: await this.attendance.listMine(user, query) };
  }

  @Get('periods/:periodId/history')
  async history(
    @CurrentUser() user: AuthUser,
    @Param('periodId') periodId: string,
  ) {
    return { data: await this.attendance.historyMine(user, periodId) };
  }
}
