import { Body, Controller, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js'; import { Roles } from '../auth/decorators/roles.decorator.js'; import { AccessTokenGuard } from '../auth/guards/access-token.guard.js'; import { RolesGuard } from '../auth/guards/roles.guard.js'; import type { AuthUser } from '../auth/interfaces/auth-user.interface.js'; import { TenantContextService } from '../auth/tenant-context.service.js'; import { AllocationsService } from './allocations.service.js';
@Controller('allocations') @UseGuards(AccessTokenGuard,RolesGuard) @Roles(UserRole.TENANT_ADMIN,UserRole.OPERATIONS_MANAGER,UserRole.FLEET_MANAGER)
export class AllocationsController { constructor(private readonly allocations:AllocationsService,private readonly tenants:TenantContextService){}
  @Post() initiate(@CurrentUser() u:AuthUser,@Body('fleetId') fleetId:string,@Body('riderId') riderId:string,@Headers('idempotency-key') key?:string){return {data:this.allocations.initiate(this.tenants.requireTenantId(u),fleetId,riderId,u.id,key)};}
  @Post(':id/deallocation/initiate') deallocate(@CurrentUser() u:AuthUser,@Param('id') id:string){return {data:this.allocations.initiateDeallocation(this.tenants.requireTenantId(u),id)};}
}
