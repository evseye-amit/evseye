import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OtpPurpose, UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { TenantContextService } from '../auth/tenant-context.service.js';
import { AuthService } from '../auth/auth.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AllocationsService } from './allocations.service.js';
import { ListAllocationsDto } from './dto/list-allocations.dto.js';
@Controller('allocations')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(
  UserRole.TENANT_ADMIN,
  UserRole.OPERATIONS_MANAGER,
  UserRole.FLEET_MANAGER,
)
export class AllocationsController {
  constructor(
    private readonly allocations: AllocationsService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly tenants: TenantContextService,
  ) {}
  @Get() async list(
    @CurrentUser() u: AuthUser,
    @Query() query: ListAllocationsDto,
  ) {
    return {
      data: await this.allocations.list(this.tenants.requireTenantId(u), query),
    };
  }
  @Get(':id') async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return {
      data: await this.allocations.get(this.tenants.requireTenantId(u), id),
    };
  }
  @Post() async initiate(
    @CurrentUser() u: AuthUser,
    @Body('fleetId') fleetId: string,
    @Body('riderId') riderId: string,
    @Headers('idempotency-key') key?: string,
  ) {
    const tenantId = this.tenants.requireTenantId(u);
    const allocation = await this.allocations.initiate(
      tenantId,
      fleetId,
      riderId,
      u.id,
      key,
    );
    await this.audit.record({
      tenantId,
      actorId: u.id,
      action: 'ALLOCATION_INITIATED',
      entityType: 'ALLOCATION',
      entityId: allocation.id,
      newData: { fleetId, riderId, status: allocation.status },
    });
    return {
      data: allocation,
    };
  }
  @Post(':id/activate') async activate(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
  ) {
    const tenantId = this.tenants.requireTenantId(u);
    const activation = await this.allocations.activate(tenantId, id);
    await this.audit.record({
      tenantId,
      actorId: u.id,
      action: 'ALLOCATION_ACTIVATED',
      entityType: 'ALLOCATION',
      entityId: id,
      newData: activation,
    });
    return {
      data: activation,
    };
  }
  @Post(':id/deallocation/initiate') async deallocate(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
  ) {
    const tenantId = this.tenants.requireTenantId(u);
    const deallocation = await this.allocations.initiateDeallocation(
      tenantId,
      id,
    );
    await this.audit.record({
      tenantId,
      actorId: u.id,
      action: 'DEALLOCATION_INITIATED',
      entityType: 'ALLOCATION',
      entityId: id,
      newData: deallocation,
    });
    return {
      data: deallocation,
    };
  }
  @Post(':id/deallocation/otp/request') async otp(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body('phone') phone: string,
    @Body('party') party: 'RIDER' | 'OPERATOR',
  ) {
    return {
      data: await this.auth.requestDeallocationOtp(
        this.tenants.requireTenantId(u),
        phone,
        id,
        party === 'RIDER'
          ? OtpPurpose.DEALLOCATION_RIDER
          : OtpPurpose.DEALLOCATION_OPERATOR,
      ),
    };
  }
  @Post(':id/deallocation/otp/verify') async verifyOtp(
    @CurrentUser() u: AuthUser,
    @Body('otpRequestId') otpRequestId: string,
    @Body('code') code: string,
  ) {
    return {
      data: await this.auth.verifyDeallocationOtp(
        this.tenants.requireTenantId(u),
        otpRequestId,
        code,
      ),
    };
  }
  @Post(':id/deallocation/complete') async complete(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
  ) {
    const tenantId = this.tenants.requireTenantId(u);
    const completion = await this.allocations.completeDeallocation(
      tenantId,
      id,
    );
    await this.audit.record({
      tenantId,
      actorId: u.id,
      action: 'DEALLOCATION_COMPLETED',
      entityType: 'ALLOCATION',
      entityId: id,
      newData: completion,
    });
    return {
      data: completion,
    };
  }
}
