import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { IfscBankService } from './banks.service.js';

@ApiTags('Banks')
@ApiBearerAuth()
@Controller('banks')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.RIDER, UserRole.FLEET_MANAGER)
export class IfscBankController {
  constructor(private readonly banks: IfscBankService) {}

  @Get('ifsc/:ifsc')
  @ApiOperation({ summary: 'Look up bank details by IFSC code' })
  @ApiParam({
    name: 'ifsc',
    description: 'Indian Financial System Code, for example HDFC0000001.',
    example: 'HDFC0000001',
  })
  @ApiOkResponse({
    description: 'Bank details found.',
    schema: {
      type: 'object',
      required: ['data'],
      properties: {
        data: {
          type: 'object',
          required: [
            'ifsc',
            'bankName',
            'branch',
            'address',
            'city',
            'district',
            'state',
            'micr',
          ],
          properties: {
            ifsc: { type: 'string', example: 'HDFC0000001' },
            bankName: { type: 'string', nullable: true, example: 'HDFC Bank' },
            branch: { type: 'string', nullable: true, example: 'MUMBAI MAIN' },
            address: { type: 'string', nullable: true, example: '1 Main Street' },
            city: { type: 'string', nullable: true, example: 'Mumbai' },
            district: { type: 'string', nullable: true, example: 'Mumbai Suburban' },
            state: { type: 'string', nullable: true, example: 'MAHARASHTRA' },
            micr: { type: 'string', nullable: true, example: '400240003' },
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'The IFSC format is invalid.',
    schema: { $ref: '#/components/schemas/ApiErrorEnvelope' },
  })
  @ApiNotFoundResponse({
    description: 'No bank details exist for this IFSC.',
    schema: { $ref: '#/components/schemas/ApiErrorEnvelope' },
  })
  @ApiBadGatewayResponse({
    description: 'The IFSC provider returned an invalid response.',
    schema: { $ref: '#/components/schemas/ApiErrorEnvelope' },
  })
  @ApiServiceUnavailableResponse({
    description: 'The IFSC provider is unavailable or timed out.',
    schema: { $ref: '#/components/schemas/ApiErrorEnvelope' },
  })
  async lookup(@Param('ifsc') ifsc: string) {
    return { data: await this.banks.lookup(ifsc) };
  }
}
