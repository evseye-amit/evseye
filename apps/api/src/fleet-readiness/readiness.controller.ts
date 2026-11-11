import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ClientContextService } from '../auth/client-context.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { FleetReadinessService } from './readiness.service.js';

@Controller('client')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(
  'CLIENT_ADMIN',
  'FLEET_MANAGER',
  'ADVISOR',
  'QC_MANAGER',
)
export class FleetReadinessController {
  constructor(
    private readonly service: FleetReadinessService,
    private readonly clients: ClientContextService,
  ) {}
  private cid(user: AuthUser) {
    return this.clients.requireClientId(user);
  }
  @Get('fleet-readiness/policy') async policy(@CurrentUser() u: AuthUser) {
    return { data: await this.service.policy(this.cid(u)) };
  }
  @Put('fleet-readiness/policy') async savePolicy(
    @CurrentUser() u: AuthUser,
    @Body() b: unknown,
  ) {
    return { data: await this.service.savePolicy(this.cid(u), u, b) };
  }
  @Post('fleet-readiness/policy/preview') async preview(
    @CurrentUser() u: AuthUser,
    @Body() b: unknown,
  ) {
    return { data: await this.service.preview(this.cid(u), u, b) };
  }
  @Get('fleet-readiness/context') async context(@CurrentUser() u: AuthUser) {
    return { data: await this.service.context(this.cid(u), u) };
  }
  @Get('fleet-readiness/staff') async staff(@CurrentUser() u: AuthUser) {
    return { data: await this.service.staff(this.cid(u), u) };
  }
  @Post('fleet-readiness/staff') async createStaff(
    @CurrentUser() u: AuthUser,
    @Body() b: unknown,
  ) {
    return { data: await this.service.createStaff(this.cid(u), u, b) };
  }
  @Put('fleet-readiness/staff/:id') async saveStaff(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return { data: await this.service.saveStaff(this.cid(u), u, id, b) };
  }
  @Get('fleet-preparations/summary') async summary(@CurrentUser() u: AuthUser) {
    return { data: await this.service.summary(this.cid(u), u) };
  }
  @Get('fleet-preparations/candidates') async candidates(
    @CurrentUser() u: AuthUser,
    @Query() q: Record<string, string>,
  ) {
    return { data: await this.service.candidates(this.cid(u), u, q) };
  }
  @Get('fleet-preparations') async list(
    @CurrentUser() u: AuthUser,
    @Query() q: Record<string, string>,
  ) {
    return { data: await this.service.list(this.cid(u), u, q) };
  }
  @Get('fleet-qc') async qc(
    @CurrentUser() u: AuthUser,
    @Query() q: Record<string, string>,
  ) {
    return { data: await this.service.list(this.cid(u), u, q, true) };
  }
  @Get('fleets/:id/readiness') async readiness(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.service.readiness(this.cid(u), u, id) };
  }
  @Patch('fleets/:id/readiness') async configureFleetReadiness(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return {
      data: await this.service.configureFleet(
        this.cid(u),
        u,
        id,
        b,
      ),
    };
  }
  @Post('fleets/:id/preparations') async start(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.service.start(this.cid(u), u, id) };
  }
  @Get('fleet-preparations/:id') async detail(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.service.detail(this.cid(u), u, id) };
  }
  @Patch('fleet-preparations/:id') async save(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return { data: await this.service.save(this.cid(u), u, id, b) };
  }
  @Post('fleet-preparations/:id/assign') async assign(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return { data: await this.service.assign(this.cid(u), u, id, b) };
  }
  @Post('fleet-preparations/:id/submit') async submit(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return { data: await this.service.submit(this.cid(u), u, id, b) };
  }
  @Post('fleet-preparations/:id/qc-approve') async approve(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return { data: await this.service.review(this.cid(u), u, id, b, true) };
  }
  @Post('fleet-preparations/:id/qc-reject') async reject(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return { data: await this.service.review(this.cid(u), u, id, b, false) };
  }
  @Post('fleet-preparations/:id/cancel') async cancel(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return { data: await this.service.cancel(this.cid(u), u, id, b) };
  }
  @Post('fleet-preparations/:id/maintenance') async maintenance(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return { data: await this.service.maintenance(this.cid(u), u, id, b) };
  }
  @Post('fleet-preparations/:id/upload-intents') async upload(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return { data: await this.service.upload(this.cid(u), u, id, b) };
  }
  @Post('fleet-preparations/:id/photos/:photoId/complete') async complete(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Body() b: unknown,
  ) {
    return {
      data: await this.service.completePhoto(this.cid(u), u, id, photoId, b),
    };
  }
  @Get('fleet-preparations/:id/photos/:photoId/download-url') async download(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
  ) {
    return { data: await this.service.download(this.cid(u), u, id, photoId) };
  }
}
