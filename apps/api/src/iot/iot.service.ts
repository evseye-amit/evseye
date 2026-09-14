import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Environment } from '../config/environment.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type TelemetryPacketType = 'LOCATION' | 'HEARTBEAT' | 'START' | 'STOP';

export interface TelemetryPacket {
  latitude?: number;
  longitude?: number;
  speedKph?: number;
  ignition?: boolean;
  occurredAt?: string;
}

@Injectable()
export class IotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async registerDevice(clientId: string, fleetId: string, deviceNumber: string) {
    const fleet = await this.prisma.fleet.findFirst({ where: { id: fleetId, clientId, deletedAt: null } });
    if (!fleet) throw new NotFoundException('Fleet not found.');

    const ingestSecret = randomBytes(32).toString('base64url');
    try {
      const device = await this.prisma.ioTDevice.create({
        data: { clientId, fleetId, deviceNumber, ingestSecretHash: this.hashSecret(ingestSecret) },
      });
      return { device, ingestSecret };
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') {
        throw new ConflictException('Device is already registered.');
      }
      throw error;
    }
  }

  async ingest(deviceNumber: string, ingestSecret: string, type: TelemetryPacketType, payload: TelemetryPacket) {
    const device = await this.prisma.ioTDevice.findFirst({ where: { deviceNumber, isActive: true } });
    if (!device) throw new NotFoundException('Device not found.');
    if (!this.matchesSecret(ingestSecret, device.ingestSecretHash)) {
      throw new UnauthorizedException('Invalid device credentials.');
    }

    const occurredAt = payload.occurredAt ? new Date(payload.occurredAt) : new Date();
    await this.prisma.vehicleCurrentState.upsert({
      where: { fleetId: device.fleetId },
      create: {
        clientId: device.clientId, fleetId: device.fleetId, deviceId: device.id,
        latitude: payload.latitude, longitude: payload.longitude, speedKph: payload.speedKph, ignition: payload.ignition,
        lastHeartbeat: type === 'HEARTBEAT' ? occurredAt : undefined,
        lastLocation: type === 'LOCATION' ? occurredAt : undefined,
      },
      update: {
        latitude: payload.latitude, longitude: payload.longitude, speedKph: payload.speedKph, ignition: payload.ignition,
        lastHeartbeat: type === 'HEARTBEAT' ? occurredAt : undefined,
        lastLocation: type === 'LOCATION' ? occurredAt : undefined,
      },
    });
    if (type === 'START' || type === 'STOP') {
      await this.prisma.telemetryEvent.create({
        data: {
          clientId: device.clientId,
          fleetId: device.fleetId,
          deviceId: device.id,
          type,
          occurredAt,
          payload: payload as Prisma.InputJsonValue,
        },
      });
    }
    return { fleetId: device.fleetId };
  }

  private hashSecret(value: string): string {
    return createHmac('sha256', this.config.getOrThrow('OTP_HASH_SECRET')).update(value).digest('hex');
  }

  private matchesSecret(value: string, expectedHash: string): boolean {
    const actual = Buffer.from(this.hashSecret(value), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
