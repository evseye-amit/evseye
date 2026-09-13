import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
@Injectable()
export class ComponentsService {
  constructor(private readonly prisma: PrismaService) {}
  private async fleet(clientId:string,fleetId:string){ const f=await this.prisma.fleet.findFirst({where:{id:fleetId,clientId,deletedAt:null}}); if(!f) throw new NotFoundException('Fleet not found.'); }
  async addBattery(clientId:string,fleetId:string,data:{serialNumber:string;batteryType?:string;capacityWh?:number;manufacturer?:string}){ await this.fleet(clientId,fleetId); try{return await this.prisma.battery.create({data:{...data,clientId,fleetId}})}catch(e){if(typeof e==='object'&&e&&'code'in e&&e.code==='P2002')throw new ConflictException('Battery serial number already exists.');throw e;} }
  async addController(clientId:string,fleetId:string,data:{serialNumber:string;manufacturer?:string}){ await this.fleet(clientId,fleetId); try{return await this.prisma.controller.create({data:{...data,clientId,fleetId}})}catch(e){if(typeof e==='object'&&e&&'code'in e&&e.code==='P2002')throw new ConflictException('Controller serial number already exists.');throw e;} }
}
