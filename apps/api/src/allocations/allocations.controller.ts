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
import { ClientContextService } from '../auth/client-context.service.js';
import { AuthService } from '../auth/auth.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AllocationsService } from './allocations.service.js';
import { CreateAllocationDto } from './dto/create-allocation.dto.js';
import { ListAllocationsDto } from './dto/list-allocations.dto.js';
import { RequestDeallocationOtpDto } from './dto/request-deallocation-otp.dto.js';
import { VerifyDeallocationOtpDto } from './dto/verify-deallocation-otp.dto.js';
@Controller('allocations')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(
  UserRole.CLIENT_ADMIN,
  UserRole.OPERATIONS_MANAGER,
  UserRole.FLEET_MANAGER,
)
export class AllocationsController {
  constructor(
    private readonly allocations: AllocationsService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly clients: ClientContextService,
  ) {}
  private isHubScopedFleetManager(user: AuthUser) {
    return user.roles.includes(UserRole.FLEET_MANAGER) && !user.roles.some((role) => role === UserRole.CLIENT_ADMIN || role === UserRole.OPERATIONS_MANAGER);
  }
  @Get() async list(
    @CurrentUser() u: AuthUser,
    @Query() query: ListAllocationsDto,
  ) {
    const clientId = this.clients.requireClientId(u);
    const hubIds = this.isHubScopedFleetManager(u) ? await this.allocations.fleetManagerHubIds(clientId, u.id) : undefined;
    return { data: await this.allocations.list(clientId, query, hubIds) };
  }
  @Get(':id') async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const clientId = this.clients.requireClientId(u);
    const hubIds = this.isHubScopedFleetManager(u) ? await this.allocations.assertFleetManagerAllocation(clientId, u.id, id) : undefined;
    return { data: await this.allocations.get(clientId, id, hubIds) };
  }
  @Post() async initiate(
    @CurrentUser() u: AuthUser,
    @Body() dto: CreateAllocationDto,
    @Headers('idempotency-key') key?: string,
  ) {
    const clientId = this.clients.requireClientId(u);
    if (this.isHubScopedFleetManager(u)) await this.allocations.assertFleetManagerFleet(clientId, u.id, dto.fleetId);
    const allocation = await this.allocations.initiate(
      clientId,
      dto.fleetId,
      dto.riderId,
      u.id,
      key,
    );
    await this.audit.record({
      clientId,
      actorId: u.id,
      action: 'ALLOCATION_INITIATED',
      entityType: 'ALLOCATION',
      entityId: allocation.id,
      newData: {
        fleetId: dto.fleetId,
        riderId: dto.riderId,
        status: allocation.status,
      },
    });
    return {
      data: allocation,
    };
  }
  @Post(':id/activate') async activate(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
  ) {
    const clientId = this.clients.requireClientId(u);
    if (this.isHubScopedFleetManager(u)) await this.allocations.assertFleetManagerAllocation(clientId, u.id, id);
    const activation = await this.allocations.activate(clientId, id);
    await this.audit.record({
      clientId,
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
    const clientId = this.clients.requireClientId(u);
    if (this.isHubScopedFleetManager(u)) await this.allocations.assertFleetManagerAllocation(clientId, u.id, id);
    const deallocation = await this.allocations.initiateDeallocation(
      clientId,
      id,
    );
    await this.audit.record({
      clientId,
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
    @Body() dto: RequestDeallocationOtpDto,
  ) {
    const clientId = this.clients.requireClientId(u);
    if (this.isHubScopedFleetManager(u)) await this.allocations.assertFleetManagerAllocation(clientId, u.id, id);
    return {
      data: await this.auth.requestDeallocationOtp(
        clientId,
        dto.phone,
        id,
        dto.party === 'RIDER'
          ? OtpPurpose.DEALLOCATION_RIDER
          : OtpPurpose.DEALLOCATION_OPERATOR,
      ),
    };
  }
  @Post(':id/deallocation/otp/verify') async verifyOtp(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() dto: VerifyDeallocationOtpDto,
  ) {
    const clientId = this.clients.requireClientId(u);
    if (this.isHubScopedFleetManager(u)) await this.allocations.assertFleetManagerAllocation(clientId, u.id, id);
    return {
      data: await this.auth.verifyDeallocationOtp(
        clientId,
        dto.otpRequestId,
        dto.code,
      ),
    };
  }
  @Post(':id/deallocation/complete') async complete(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
  ) {
    const clientId = this.clients.requireClientId(u);
    if (this.isHubScopedFleetManager(u)) await this.allocations.assertFleetManagerAllocation(clientId, u.id, id);
    const completion = await this.allocations.completeDeallocation(
      clientId,
      id,
    );
    await this.audit.record({
      clientId,
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
