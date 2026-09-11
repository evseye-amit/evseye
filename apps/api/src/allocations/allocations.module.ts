import { Module } from '@nestjs/common'; import { AuthModule } from '../auth/auth.module.js'; import { AllocationsService } from './allocations.service.js'; import { AllocationsController } from './allocations.controller.js';
@Module({imports:[AuthModule],controllers:[AllocationsController],providers:[AllocationsService],exports:[AllocationsService]}) export class AllocationsModule {}
