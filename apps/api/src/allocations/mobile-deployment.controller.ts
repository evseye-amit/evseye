import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ApiHeader } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { ClientContextService } from '../auth/client-context.service.js';
import { MobileDeploymentService } from './mobile-deployment.service.js';
import { AcceptPdiDto, AskPaymentDto, BypassPairingDto, FleetManagerAllocateDto, PairDeviceDto, PdiVoiceUploadIntentDto, SubmitPdiDto, SubmitPaymentReferenceDto, TrainingViewedDto } from './dto/mobile-deployment.dto.js';
import { requestLocale } from '../common/locale.js';
import { mobileStatusLabels } from './mobile-status-locales.js';

@Controller('mobile-deployments')
@ApiHeader({ name: 'Accept-Language', required: false, description: 'Response language: en-IN, hi-IN, te-IN, or kn-IN. Defaults to English.' })
@UseGuards(AccessTokenGuard, RolesGuard)
export class MobileDeploymentController {
  constructor(private readonly deployments: MobileDeploymentService, private readonly clients: ClientContextService) {}
  @Get('localization') @Roles(UserRole.RIDER, UserRole.FLEET_MANAGER)
  localization(@Headers('accept-language') language?: string) { return { data: mobileStatusLabels(requestLocale(language)) }; }
  @Get('fleet-manager/pending-riders') @Roles(UserRole.FLEET_MANAGER)
  async pendingRiders(@CurrentUser() user: AuthUser) { return { data: await this.deployments.pendingRiders(this.clients.requireClientId(user), user.id) }; }
  @Get('fleet-manager/eligible-fleets') @Roles(UserRole.FLEET_MANAGER)
  async eligibleFleets(@CurrentUser() user: AuthUser) { return { data: await this.deployments.eligibleFleets(this.clients.requireClientId(user), user.id) }; }
  @Post('fleet-manager/allocate') @Roles(UserRole.FLEET_MANAGER)
  async allocate(@CurrentUser() user: AuthUser, @Body() body: FleetManagerAllocateDto) { return { data: await this.deployments.allocateFleet(this.clients.requireClientId(user), user.id, body.riderId, body.fleetId) }; }
  @Get('fleet-manager/requests') @Roles(UserRole.FLEET_MANAGER)
  async requests(@CurrentUser() user: AuthUser) { return { data: await this.deployments.fleetRequests(this.clients.requireClientId(user), user.id) }; }
  @Get('rider/current') @Roles(UserRole.RIDER)
  async riderCurrent(@CurrentUser() user: AuthUser) { return { data: await this.deployments.riderCurrent(this.clients.requireClientId(user), user.id) }; }
  @Get('rider/wallet') @Roles(UserRole.RIDER)
  async riderWallet(@CurrentUser() user: AuthUser) { return { data: await this.deployments.riderWallet(this.clients.requireClientId(user), user.id) }; }
  @Post(':id/request-fleet') @Roles(UserRole.FLEET_MANAGER)
  async requestFleet(@CurrentUser() user: AuthUser, @Param('id') id: string) { return { data: await this.deployments.requestFleet(this.clients.requireClientId(user), user.id, id) }; }
  @Post(':id/ask-payment') @Roles(UserRole.FLEET_MANAGER)
  async askPayment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: AskPaymentDto) { return { data: await this.deployments.askPayment(this.clients.requireClientId(user), user.id, id, body) }; }
  @Get(':id/payment') @Roles(UserRole.RIDER)
  async payment(@CurrentUser() user: AuthUser, @Param('id') id: string) { return { data: await this.deployments.payment(this.clients.requireClientId(user), user.id, id) }; }
  @Post(':id/payment/submit') @Roles(UserRole.RIDER)
  async submitPayment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: SubmitPaymentReferenceDto) { return { data: await this.deployments.submitPaymentReference(this.clients.requireClientId(user), user.id, id, body.provider, body.providerReference) }; }
  @Post(':id/payment/verify') @Roles(UserRole.FLEET_MANAGER)
  async verifyPayment(@CurrentUser() user: AuthUser, @Param('id') id: string) { return { data: await this.deployments.verifyPayment(this.clients.requireClientId(user), user.id, id) }; }
  @Get(':id/allocation-evidence') @Roles(UserRole.FLEET_MANAGER)
  async allocationEvidence(@CurrentUser() user: AuthUser, @Param('id') id: string) { return { data: await this.deployments.getAllocationEvidence(this.clients.requireClientId(user), user.id, id) }; }
  @Post(':id/pdi') @Roles(UserRole.FLEET_MANAGER)
  async pdi(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: SubmitPdiDto) { return { data: await this.deployments.submitPdi(this.clients.requireClientId(user), user.id, id, body.workPartnerName, body.checklist) }; }
  @Post(':id/pdi/voice-upload-intent') @Roles(UserRole.RIDER)
  async pdiVoiceIntent(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: PdiVoiceUploadIntentDto) { return { data: await this.deployments.createPdiVoiceUploadIntent(this.clients.requireClientId(user), user.id, id, body) }; }
  @Post(':id/pdi/voice/:photoId/complete') @Roles(UserRole.RIDER)
  async completePdiVoice(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('photoId') photoId: string) { return { data: await this.deployments.completePdiVoiceUpload(this.clients.requireClientId(user), user.id, id, photoId) }; }
  @Post(':id/accept-pdi') @Roles(UserRole.RIDER)
  async acceptPdi(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: AcceptPdiDto) { return { data: await this.deployments.acceptPdi(this.clients.requireClientId(user), user.id, id, body.items) }; }
  @Post(':id/training/complete') @Roles(UserRole.RIDER)
  async training(@CurrentUser() user: AuthUser, @Param('id') id: string) { return { data: await this.deployments.completeTraining(this.clients.requireClientId(user), user.id, id) }; }
  @Get(':id/training') @Roles(UserRole.RIDER)
  async trainingContent(@CurrentUser() user: AuthUser, @Param('id') id: string, @Headers('accept-language') language?: string) { return { data: await this.deployments.training(this.clients.requireClientId(user), user.id, id, requestLocale(language)) }; }
  @Post(':id/training/viewed') @Roles(UserRole.RIDER)
  async trainingViewed(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: TrainingViewedDto) { return { data: await this.deployments.markTrainingViewed(this.clients.requireClientId(user), user.id, id, body.contentCode) }; }
  @Get(':id/iot-health') @Roles(UserRole.FLEET_MANAGER)
  async iotHealth(@CurrentUser() user: AuthUser, @Param('id') id: string) { return { data: await this.deployments.iotHealth(this.clients.requireClientId(user), user.id, id) }; }
  @Post(':id/pair') @Roles(UserRole.RIDER)
  async pair(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: PairDeviceDto) { return { data: await this.deployments.pair(this.clients.requireClientId(user), user.id, id, body.deviceNumber) }; }
  @Post(':id/pair/bypass') @Roles(UserRole.FLEET_MANAGER)
  async bypass(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: BypassPairingDto) { return { data: await this.deployments.bypassPairing(this.clients.requireClientId(user), user.id, id, body.remarks) }; }
}
