import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Patch,
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

  @IsOptional()
  @IsString()
  @MaxLength(30)
  imei?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  simNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  iccid?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  provider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @IsOptional()
  @IsISO8601()
  installedAt?: string;
}

class UpdateDeviceDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  imei?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  simNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  iccid?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  provider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @IsOptional()
  @IsISO8601()
  installedAt?: string;
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
        dto,
      ),
    };
  }

  @Patch('devices/:id')
  @Header('Cache-Control', 'no-store')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateDeviceDto,
  ) {
    return {
      data: await this.iot.updateDevice(
        this.clients.requireClientId(user),
        id,
        dto,
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
