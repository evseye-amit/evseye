import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { ClientContextService } from '../auth/client-context.service.js';
import { MobileDeploymentService } from './mobile-deployment.service.js';
import { AcceptPdiDto, AskPaymentDto, BypassPairingDto, FleetManagerAllocateDto, PairDeviceDto, PdiVoiceUploadIntentDto, SubmitPdiDto, SubmitPaymentReferenceDto, TrainingViewedDto } from './dto/mobile-deployment.dto.js';

@Controller('mobile-deployments')
@UseGuards(AccessTokenGuard, RolesGuard)
export class MobileDeploymentController {
  constructor(private readonly deployments: MobileDeploymentService, private readonly clients: ClientContextService) {}
  @Get('fleet-manager/pending-riders') @Roles(UserRole.FLEET_MANAGER)
  pendingRiders(@CurrentUser() user: AuthUser) { return { data: this.deployments.pendingRiders(this.clients.requireClientId(user), user.id) }; }
  @Get('fleet-manager/eligible-fleets') @Roles(UserRole.FLEET_MANAGER)
  eligibleFleets(@CurrentUser() user: AuthUser) { return { data: this.deployments.eligibleFleets(this.clients.requireClientId(user), user.id) }; }
  @Post('fleet-manager/allocate') @Roles(UserRole.FLEET_MANAGER)
  allocate(@CurrentUser() user: AuthUser, @Body() body: FleetManagerAllocateDto) { return { data: this.deployments.allocateFleet(this.clients.requireClientId(user), user.id, body.riderId, body.fleetId) }; }
  @Get('fleet-manager/requests') @Roles(UserRole.FLEET_MANAGER)
  requests(@CurrentUser() user: AuthUser) { return { data: this.deployments.fleetRequests(this.clients.requireClientId(user), user.id) }; }
  @Get('rider/current') @Roles(UserRole.RIDER)
  riderCurrent(@CurrentUser() user: AuthUser) { return { data: this.deployments.riderCurrent(this.clients.requireClientId(user), user.id) }; }
  @Get('rider/wallet') @Roles(UserRole.RIDER)
  riderWallet(@CurrentUser() user: AuthUser) { return { data: this.deployments.riderWallet(this.clients.requireClientId(user), user.id) }; }
  @Post(':id/request-fleet') @Roles(UserRole.FLEET_MANAGER)
  requestFleet(@CurrentUser() user: AuthUser, @Param('id') id: string) { return { data: this.deployments.requestFleet(this.clients.requireClientId(user), user.id, id) }; }
  @Post(':id/ask-payment') @Roles(UserRole.FLEET_MANAGER)
  askPayment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: AskPaymentDto) { return { data: this.deployments.askPayment(this.clients.requireClientId(user), user.id, id, body) }; }
  @Get(':id/payment') @Roles(UserRole.RIDER)
  payment(@CurrentUser() user: AuthUser, @Param('id') id: string) { return { data: this.deployments.payment(this.clients.requireClientId(user), user.id, id) }; }
  @Post(':id/payment/submit') @Roles(UserRole.RIDER)
  submitPayment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: SubmitPaymentReferenceDto) { return { data: this.deployments.submitPaymentReference(this.clients.requireClientId(user), user.id, id, body.provider, body.providerReference) }; }
  @Post(':id/payment/verify') @Roles(UserRole.FLEET_MANAGER)
  verifyPayment(@CurrentUser() user: AuthUser, @Param('id') id: string) { return { data: this.deployments.verifyPayment(this.clients.requireClientId(user), user.id, id) }; }
  @Get(':id/allocation-evidence') @Roles(UserRole.FLEET_MANAGER)
  allocationEvidence(@CurrentUser() user: AuthUser, @Param('id') id: string) { return { data: this.deployments.getAllocationEvidence(this.clients.requireClientId(user), user.id, id) }; }
  @Post(':id/pdi') @Roles(UserRole.FLEET_MANAGER)
  pdi(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: SubmitPdiDto) { return { data: this.deployments.submitPdi(this.clients.requireClientId(user), user.id, id, body.workPartnerName, body.checklist) }; }
  @Post(':id/pdi/voice-upload-intent') @Roles(UserRole.RIDER)
  pdiVoiceIntent(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: PdiVoiceUploadIntentDto) { return { data: this.deployments.createPdiVoiceUploadIntent(this.clients.requireClientId(user), user.id, id, body) }; }
  @Post(':id/pdi/voice/:photoId/complete') @Roles(UserRole.RIDER)
  completePdiVoice(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('photoId') photoId: string) { return { data: this.deployments.completePdiVoiceUpload(this.clients.requireClientId(user), user.id, id, photoId) }; }
  @Post(':id/accept-pdi') @Roles(UserRole.RIDER)
  acceptPdi(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: AcceptPdiDto) { return { data: this.deployments.acceptPdi(this.clients.requireClientId(user), user.id, id, body.items) }; }
  @Post(':id/training/complete') @Roles(UserRole.RIDER)
  training(@CurrentUser() user: AuthUser, @Param('id') id: string) { return { data: this.deployments.completeTraining(this.clients.requireClientId(user), user.id, id) }; }
  @Get(':id/training') @Roles(UserRole.RIDER)
  trainingContent(@CurrentUser() user: AuthUser, @Param('id') id: string) { return { data: this.deployments.training(this.clients.requireClientId(user), user.id, id) }; }
  @Post(':id/training/viewed') @Roles(UserRole.RIDER)
  trainingViewed(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: TrainingViewedDto) { return { data: this.deployments.markTrainingViewed(this.clients.requireClientId(user), user.id, id, body.contentCode) }; }
  @Get(':id/iot-health') @Roles(UserRole.FLEET_MANAGER)
  iotHealth(@CurrentUser() user: AuthUser, @Param('id') id: string) { return { data: this.deployments.iotHealth(this.clients.requireClientId(user), user.id, id) }; }
  @Post(':id/pair') @Roles(UserRole.RIDER)
  pair(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: PairDeviceDto) { return { data: this.deployments.pair(this.clients.requireClientId(user), user.id, id, body.deviceNumber) }; }
  @Post(':id/pair/bypass') @Roles(UserRole.FLEET_MANAGER)
  bypass(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: BypassPairingDto) { return { data: this.deployments.bypassPairing(this.clients.requireClientId(user), user.id, id, body.remarks) }; }
}
