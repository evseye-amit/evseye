import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { ClientContextService } from '../auth/client-context.service.js';
import { IotService, type TelemetryPacketType } from './iot.service.js';

class RegisterDeviceDto {
  @IsString()
  fleetId!: string;

  @IsString()
  @MaxLength(128)
  deviceNumber!: string;
}

class IngestTelemetryDto {
  @IsString()
  @MaxLength(128)
  deviceNumber!: string;

  @IsIn(['LOCATION', 'HEARTBEAT', 'START', 'STOP'])
  type!: TelemetryPacketType;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  speedKph?: number;

  @IsOptional()
  @IsBoolean()
  ignition?: boolean;

  @IsOptional()
  @IsISO8601()
  occurredAt?: string;
}

@Controller('iot')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN, UserRole.FLEET_MANAGER)
export class IotController {
  constructor(
    private readonly iot: IotService,
    private readonly clients: ClientContextService,
  ) {}

  @Get('devices')
  @Header('Cache-Control', 'no-store')
  async list(@CurrentUser() user: AuthUser) {
    return {
      data: await this.iot.listDevices(this.clients.requireClientId(user)),
    };
  }

  @Post('devices')
  @Header('Cache-Control', 'no-store')
  async register(
    @CurrentUser() user: AuthUser,
    @Body() dto: RegisterDeviceDto,
  ) {
    return {
      data: await this.iot.registerDevice(
        this.clients.requireClientId(user),
        dto.fleetId,
        dto.deviceNumber,
      ),
    };
  }
}

@Controller('iot')
export class IotIngestionController {
  constructor(private readonly iot: IotService) {}

  @Post('ingest')
  @HttpCode(202)
  async ingest(
    @Headers('x-device-secret') ingestSecret: string | undefined,
    @Body() dto: IngestTelemetryDto,
  ) {
    if (!ingestSecret)
      throw new UnauthorizedException('Missing device credentials.');
    return {
      data: await this.iot.ingest(
        dto.deviceNumber,
        ingestSecret,
        dto.type,
        dto,
      ),
    };
  }
}
