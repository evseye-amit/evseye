import { Module } from '@nestjs/common'; import { DashboardService } from './dashboard.service.js'; @Module({providers:[DashboardService],exports:[DashboardService]}) export class DashboardModule {}
