import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import { OtpPurpose, UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js'; import { Roles } from '../auth/decorators/roles.decorator.js'; import { AccessTokenGuard } from '../auth/guards/access-token.guard.js'; import { RolesGuard } from '../auth/guards/roles.guard.js'; import type { AuthUser } from '../auth/interfaces/auth-user.interface.js'; import { TenantContextService } from '../auth/tenant-context.service.js'; import { AuthService } from '../auth/auth.service.js'; import { AllocationsService } from './allocations.service.js'; import { ListAllocationsDto } from './dto/list-allocations.dto.js';
@Controller('allocations') @UseGuards(AccessTokenGuard,RolesGuard) @Roles(UserRole.TENANT_ADMIN,UserRole.OPERATIONS_MANAGER,UserRole.FLEET_MANAGER)
export class AllocationsController { constructor(private readonly allocations:AllocationsService,private readonly auth:AuthService,private readonly tenants:TenantContextService){}
  @Get() list(@CurrentUser() u:AuthUser,@Query() query:ListAllocationsDto){return {data:this.allocations.list(this.tenants.requireTenantId(u),query)};}
  @Get(':id') get(@CurrentUser() u:AuthUser,@Param('id') id:string){return {data:this.allocations.get(this.tenants.requireTenantId(u),id)};}
  @Post() initiate(@CurrentUser() u:AuthUser,@Body('fleetId') fleetId:string,@Body('riderId') riderId:string,@Headers('idempotency-key') key?:string){return {data:this.allocations.initiate(this.tenants.requireTenantId(u),fleetId,riderId,u.id,key)};}
  @Post(':id/activate') activate(@CurrentUser() u:AuthUser,@Param('id') id:string){return {data:this.allocations.activate(this.tenants.requireTenantId(u),id)};}
  @Post(':id/deallocation/initiate') deallocate(@CurrentUser() u:AuthUser,@Param('id') id:string){return {data:this.allocations.initiateDeallocation(this.tenants.requireTenantId(u),id)};}
  @Post(':id/deallocation/otp/request') otp(@CurrentUser() u:AuthUser,@Param('id') id:string,@Body('phone') phone:string,@Body('party') party:'RIDER'|'OPERATOR'){return {data:this.auth.requestDeallocationOtp(this.tenants.requireTenantId(u),phone,id,party==='RIDER'?OtpPurpose.DEALLOCATION_RIDER:OtpPurpose.DEALLOCATION_OPERATOR)};}
  @Post(':id/deallocation/otp/verify') verifyOtp(@CurrentUser() u:AuthUser,@Body('otpRequestId') otpRequestId:string,@Body('code') code:string){return {data:this.auth.verifyDeallocationOtp(this.tenants.requireTenantId(u),otpRequestId,code)};}
  @Post(':id/deallocation/complete') complete(@CurrentUser() u:AuthUser,@Param('id') id:string){return {data:this.allocations.completeDeallocation(this.tenants.requireTenantId(u),id)};}
}
