import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AllocationStatus, InspectionStatus, PhotoEntityType, PhotoStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
@Injectable()
export class InspectionsService { constructor(private readonly prisma:PrismaService){}
  async complete(tenantId:string,inspectionId:string,actorId:string){
    const inspection=await this.prisma.inspection.findFirst({where:{id:inspectionId,tenantId},include:{allocation:true}}); if(!inspection)throw new NotFoundException('Inspection not found.');
    const required=await this.prisma.photoRequirement.findMany({where:{tenantId,entityType:PhotoEntityType.INSPECTION,isRequired:true}});
    const complete=await this.prisma.photo.findMany({where:{tenantId,entityType:PhotoEntityType.INSPECTION,entityId:inspectionId,status:PhotoStatus.COMPLETE},select:{photoType:true}});
    const types=new Set(complete.map(p=>p.photoType)); const missing=required.filter(r=>!types.has(r.photoType)).map(r=>r.photoType); if(missing.length)throw new BadRequestException({message:'Required inspection photos are missing.',missing});
    return this.prisma.$transaction(async tx=>{const updated=await tx.inspection.update({where:{id:inspectionId},data:{status:InspectionStatus.COMPLETED,completedBy:actorId,completedAt:new Date()}}); if(inspection.allocation.status===AllocationStatus.INSPECTION_PENDING)await tx.allocation.update({where:{id:inspection.allocationId},data:{status:AllocationStatus.OTP_PENDING}}); return updated;});
  }
}
