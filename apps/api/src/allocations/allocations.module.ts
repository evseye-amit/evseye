import { Module } from '@nestjs/common'; import { AllocationsService } from './allocations.service.js';
@Module({providers:[AllocationsService],exports:[AllocationsService]}) export class AllocationsModule {}
