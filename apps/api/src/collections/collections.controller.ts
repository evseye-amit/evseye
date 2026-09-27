import {
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { ClientContextService } from '../auth/client-context.service.js';
import { RiderBillingService } from '../rider-billing/rider-billing.service.js';
import { CollectionsService } from './collections.service.js';

@Controller('collections')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN, UserRole.OPERATIONS_MANAGER)
export class CollectionsController {
  constructor(
    private readonly collections: CollectionsService,
    private readonly clients: ClientContextService,
  ) {}
  @Get('policies')
  policies(@CurrentUser() user: AuthUser) {
    return this.collections.listPolicies(this.clients.requireClientId(user));
  }
  @Post('policies')
  @Roles(UserRole.CLIENT_ADMIN)
  async policy(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return {
      data: await this.collections.createPolicy(
        this.clients.requireClientId(user),
        user.id,
        body,
      ),
    };
  }
  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthUser) {
    return this.collections.dashboard(
      this.clients.requireClientId(user),
      user.id,
    );
  }
  @Get('cases')
  cases(
    @CurrentUser() user: AuthUser,
    @Query()
    filters: {
      status?: string;
      stage?: string;
      riderId?: string;
      agreementId?: string;
      assignedToId?: string;
      daysPastDue?: number;
      page?: number;
    },
  ) {
    return this.collections.cases(this.clients.requireClientId(user), filters);
  }
  @Get('cases/:id')
  case(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.collections.requireCase(this.clients.requireClientId(user), id);
  }
  @Get('riders/:riderId/summary')
  summary(@CurrentUser() user: AuthUser, @Param('riderId') riderId: string) {
    return this.collections.summary(
      this.clients.requireClientId(user),
      riderId,
    );
  }
  @Post('cases/:id/evaluate')
  async evaluate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const clientId = this.clients.requireClientId(user);
    const item = await this.collections.requireCase(clientId, id);
    return { data: await this.collections.evaluate(clientId, item.riderId) };
  }
  @Post('cases/:id/assign')
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { userId: string },
  ) {
    return this.collections.assign(
      this.clients.requireClientId(user),
      id,
      user.id,
      body.userId,
    );
  }
  @Post('cases/:id/notes')
  note(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.collections.note(
      this.clients.requireClientId(user),
      id,
      user.id,
      body,
    );
  }
  @Post('cases/:id/promises')
  promise(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.collections.promise(
      this.clients.requireClientId(user),
      id,
      user.id,
      'OPERATIONS',
      body,
    );
  }
  @Post('cases/:id/waivers')
  waiver(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.collections.waiver(
      this.clients.requireClientId(user),
      id,
      user.id,
      body,
    );
  }
  @Post('waivers/:id/approve')
  @Roles(UserRole.CLIENT_ADMIN)
  approveWaiver(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.collections.approveWaiver(
      this.clients.requireClientId(user),
      id,
      user.id,
    );
  }
  @Post('waivers/:id/apply')
  @Roles(UserRole.CLIENT_ADMIN)
  applyWaiver(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.collections.applyWaiver(
      this.clients.requireClientId(user),
      id,
      user.id,
    );
  }
  @Post('cases/:id/disputes')
  dispute(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    return this.collections.dispute(
      this.clients.requireClientId(user),
      id,
      user.id,
      body.reason,
    );
  }
  @Post('cases/:id/tasks')
  task(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.collections.createTask(
      this.clients.requireClientId(user),
      id,
      user.id,
      body,
    );
  }
  @Post('tasks/:id/complete')
  completeTask(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { result: string },
  ) {
    return this.collections.completeTask(
      this.clients.requireClientId(user),
      id,
      user.id,
      body.result,
    );
  }
  @Post('disputes/:id/resolve')
  resolveDispute(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { resolution: string },
  ) {
    return this.collections.resolveDispute(
      this.clients.requireClientId(user),
      id,
      user.id,
      body.resolution,
    );
  }
  @Post('cases/:id/actions')
  action(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: { actionType: string },
  ) {
    return this.collections.manualAction(
      this.clients.requireClientId(user),
      id,
      user.id,
      body.actionType,
      key,
    );
  }
  @Get('late-fee-policy')
  lateFeePolicy(@CurrentUser() user: AuthUser) {
    return this.collections.lateFeePolicy(this.clients.requireClientId(user));
  }
  @Post('cases/:id/late-fee')
  @Roles(UserRole.CLIENT_ADMIN)
  applyLateFee(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.collections.applyLateFee(
      this.clients.requireClientId(user),
      id,
      user.id,
    );
  }
  @Post('late-fee-policy')
  @Roles(UserRole.CLIENT_ADMIN)
  setLateFeePolicy(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.collections.setLateFeePolicy(
      this.clients.requireClientId(user),
      user.id,
      body,
    );
  }
  @Post('cases/:id/restrictions/recommend')
  recommend(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { code: string; reason: string },
  ) {
    return this.collections.restriction(
      this.clients.requireClientId(user),
      id,
      user.id,
      body.code,
      false,
      body.reason,
    );
  }
  @Post('cases/:id/restrictions/apply')
  @Roles(UserRole.CLIENT_ADMIN)
  restrict(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { code: string; reason: string },
  ) {
    return this.collections.restriction(
      this.clients.requireClientId(user),
      id,
      user.id,
      body.code,
      true,
      body.reason,
    );
  }
  @Post('restrictions/:id/remove')
  @Roles(UserRole.CLIENT_ADMIN)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.collections.removeRestriction(
      this.clients.requireClientId(user),
      id,
      user.id,
    );
  }
}

@Controller('rider-app/collections')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.RIDER)
export class RiderCollectionsController {
  constructor(
    private readonly collections: CollectionsService,
    private readonly clients: ClientContextService,
    private readonly billing: RiderBillingService,
  ) {}
  @Get('summary')
  async summary(@CurrentUser() user: AuthUser) {
    const clientId = this.clients.requireClientId(user);
    const riderId = await this.billing.riderForUser(clientId, user.id);
    return { data: await this.collections.riderSummary(clientId, riderId) };
  }
  @Post('promises')
  async promise(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      caseId: string;
      promisedAmount: string;
      promiseDate: string;
      notes?: string;
    },
  ) {
    const clientId = this.clients.requireClientId(user);
    const riderId = await this.billing.riderForUser(clientId, user.id);
    const item = await this.collections.requireCase(clientId, body.caseId);
    if (item.riderId !== riderId)
      throw new NotFoundException({ code: 'COLLECTION_CASE_NOT_FOUND' });
    return {
      data: await this.collections.promise(
        clientId,
        body.caseId,
        user.id,
        'RIDER',
        body,
      ),
    };
  }
}
