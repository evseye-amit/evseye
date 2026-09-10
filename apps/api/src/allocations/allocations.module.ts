import { Module } from '@nestjs/common'; import { AllocationsService } from './allocations.service.js'; import { AllocationsController } from './allocations.controller.js';
@Module({controllers:[AllocationsController],providers:[AllocationsService],exports:[AllocationsService]}) export class AllocationsModule {}
