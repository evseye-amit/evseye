import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AttendanceAdminController } from './attendance-admin.controller.js';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';

@Module({
  imports: [AuthModule],
  controllers: [AttendanceController, AttendanceAdminController],
  providers: [AttendanceService],
})
export class AttendanceModule {}
