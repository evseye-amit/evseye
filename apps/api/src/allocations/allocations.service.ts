import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { FleetStatus, InspectionStatus, InspectionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AllocationsService {
  constructor(private readonly prisma: PrismaService) {}
  async initiate(tenantId:string, fleetId:string, riderId:string, actorId:string, idempotencyKey?:string) {
    return this.prisma.$transaction(async tx => {
      const rider=await tx.rider.findFirst({where:{id:riderId,tenantId,deletedAt:null}}); if(!rider) throw new NotFoundException('Rider not found.');
      const reserved=await tx.fleet.updateMany({where:{id:fleetId,tenantId,status:FleetStatus.AVAILABLE,deletedAt:null},data:{status:FleetStatus.RESERVED}});
      if(reserved.count!==1) throw new ConflictException('Fleet is not available for allocation.');
      const allocation=await tx.allocation.create({data:{tenantId,fleetId,riderId,initiatedById:actorId,idempotencyKey,status:'INSPECTION_PENDING'}});
      await tx.inspection.create({data:{tenantId,allocationId:allocation.id,type:InspectionType.PRE_ALLOCATION,status:InspectionStatus.DRAFT}});
      return allocation;
    });
  }
}
