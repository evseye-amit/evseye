import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
@Injectable()
export class IotService { constructor(private readonly prisma:PrismaService){}
  async registerDevice(tenantId:string,fleetId:string,deviceNumber:string){const fleet=await this.prisma.fleet.findFirst({where:{id:fleetId,tenantId,deletedAt:null}});if(!fleet)throw new NotFoundException('Fleet not found.');try{return await this.prisma.ioTDevice.create({data:{tenantId,fleetId,deviceNumber}})}catch(e){if(typeof e==='object'&&e&&'code'in e&&e.code==='P2002')throw new ConflictException('Device is already registered.');throw e;}}
}
