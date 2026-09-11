import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AllocationStatus, FleetStatus, InspectionStatus, InspectionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ListAllocationsDto } from './dto/list-allocations.dto.js';

@Injectable()
export class AllocationsService {
  constructor(private readonly prisma: PrismaService) {}
  async list(tenantId: string, query: ListAllocationsDto) {
    const where = {
      tenantId,
      ...(query.status ? { status: query.status as AllocationStatus } : {}),
      ...(query.riderId ? { riderId: query.riderId } : {}),
      ...(query.fleetId ? { fleetId: query.fleetId } : {}),
      ...(query.search ? {
        OR: [
          { fleet: { vehicleNumber: { contains: query.search, mode: 'insensitive' as const } } },
          { rider: { name: { contains: query.search, mode: 'insensitive' as const } } },
          { rider: { mobile: { contains: query.search } } },
        ],
      } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.allocation.findMany({
        where,
        include: { rider: true, fleet: { include: { hub: true } }, inspections: true },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.allocation.count({ where }),
    ]);
    return { items, meta: { page: query.page, pageSize: query.pageSize, total } };
  }

  async get(tenantId: string, allocationId: string) {
    const allocation = await this.prisma.allocation.findFirst({
      where: { id: allocationId, tenantId },
      include: { rider: true, fleet: { include: { hub: true } }, inspections: true },
    });
    if (!allocation) throw new NotFoundException('Allocation not found.');
    return allocation;
  }

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
  async activate(tenantId: string, allocationId: string) {
    return this.prisma.$transaction(async tx => {
      const allocation = await tx.allocation.findFirst({
        where: { id: allocationId, tenantId, status: AllocationStatus.OTP_PENDING },
      });
      if (!allocation) throw new NotFoundException('Allocation awaiting activation not found.');

      const inspection = await tx.inspection.findFirst({
        where: {
          tenantId,
          allocationId,
          type: InspectionType.PRE_ALLOCATION,
          status: InspectionStatus.COMPLETED,
        },
      });
      if (!inspection) throw new ConflictException('Pre-allocation inspection is incomplete.');

      const activated = await tx.allocation.updateMany({
        where: { id: allocationId, tenantId, status: AllocationStatus.OTP_PENDING },
        data: { status: AllocationStatus.ACTIVE, allocatedAt: new Date() },
      });
      if (activated.count !== 1) throw new ConflictException('Allocation state changed; retry the request.');

      const fleet = await tx.fleet.updateMany({
        where: { id: allocation.fleetId, tenantId, status: FleetStatus.RESERVED, deletedAt: null },
        data: { status: FleetStatus.ALLOCATED },
      });
      if (fleet.count !== 1) throw new ConflictException('Fleet is not reserved for this allocation.');

      return { activated: true, allocationId };
    });
  }
  async initiateDeallocation(tenantId:string, allocationId:string) {
    return this.prisma.$transaction(async tx=>{
      const allocation=await tx.allocation.findFirst({where:{id:allocationId,tenantId,status:AllocationStatus.ACTIVE}}); if(!allocation)throw new NotFoundException('Active allocation not found.');
      await tx.allocation.update({where:{id:allocation.id},data:{status:AllocationStatus.DEALLOCATION_INITIATED}});
      await tx.fleet.updateMany({where:{id:allocation.fleetId,tenantId,status:{in:[FleetStatus.ALLOCATED,FleetStatus.IN_USE]}},data:{status:FleetStatus.DEALLOCATION_IN_PROGRESS}});
      const inspection=await tx.inspection.upsert({where:{allocationId_type:{allocationId:allocation.id,type:InspectionType.POST_DEALLOCATION}},create:{tenantId,allocationId:allocation.id,type:InspectionType.POST_DEALLOCATION,status:InspectionStatus.DRAFT},update:{}});
      return {allocationId:allocation.id,inspectionId:inspection.id};
    });
  }
  async completeDeallocation(tenantId:string,allocationId:string){return this.prisma.$transaction(async tx=>{const a=await tx.allocation.findFirst({where:{id:allocationId,tenantId,status:AllocationStatus.DEALLOCATION_INITIATED}});if(!a)throw new NotFoundException('Deallocation not found.');const inspection=await tx.inspection.findFirst({where:{allocationId,type:InspectionType.POST_DEALLOCATION,status:InspectionStatus.COMPLETED}});if(!inspection)throw new ConflictException('Post-deallocation inspection is incomplete.');const otps=await tx.otpRequest.findMany({where:{tenantId,status:'VERIFIED',purpose:{in:['DEALLOCATION_RIDER','DEALLOCATION_OPERATOR']}}});const purposes=new Set(otps.filter(o=>(o.context as {allocationId?:string}|null)?.allocationId===allocationId).map(o=>o.purpose));if(!purposes.has('DEALLOCATION_RIDER')||!purposes.has('DEALLOCATION_OPERATOR'))throw new ConflictException('Both deallocation OTPs must be verified.');await tx.allocation.update({where:{id:allocationId},data:{status:AllocationStatus.COMPLETED,deallocatedAt:new Date()}});await tx.fleet.update({where:{id:a.fleetId},data:{status:FleetStatus.AVAILABLE}});return {completed:true};});}
}
