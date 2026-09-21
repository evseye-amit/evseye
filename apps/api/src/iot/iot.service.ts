import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoTDeviceStatus, Prisma } from '@prisma/client';
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

  async registerDevice(
    clientId: string,
    fleetId: string,
    deviceNumber: string,
    details?: {
      imei?: string;
      simNumber?: string;
      iccid?: string;
      provider?: string;
      model?: string;
      installedAt?: string;
    },
  ) {
    const fleet = await this.prisma.fleet.findFirst({
      where: { id: fleetId, clientId, deletedAt: null },
    });
    if (!fleet) throw new NotFoundException('Fleet not found.');

    const ingestSecret = randomBytes(32).toString('base64url');
    try {
      const device = await this.prisma.ioTDevice.create({
        data: {
          clientId,
          deviceNumber: deviceNumber.trim(),
          imei: details?.imei?.trim() || undefined,
          simNumber: details?.simNumber?.trim() || undefined,
          iccid: details?.iccid?.trim() || undefined,
          provider: details?.provider?.trim() || undefined,
          model: details?.model?.trim() || undefined,
          ingestSecretHash: this.hashSecret(ingestSecret),
          status: IoTDeviceStatus.ACTIVE,
          installedAt: details?.installedAt
            ? new Date(details.installedAt)
            : undefined,
          activatedAt: new Date(),
        },
      });
      await this.prisma.fleet.update({
        where: { id: fleetId },
        data: { iotDeviceId: device.id },
      });
      return { device, ingestSecret };
    } catch (error) {
      if (
        typeof error === 'object' &&
        error &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Device is already registered.');
      }
      throw error;
    }
  }

  listDevices(clientId: string) {
    return this.prisma.ioTDevice.findMany({
      where: { clientId },
      include: {
        currentFleet: {
          select: { id: true, fleetCode: true, vehicleNumber: true },
        },
        currentState: {
          select: {
            isOnline: true,
            lastHeartbeatAt: true,
            lastLocationAt: true,
            batterySoc: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateDevice(
    clientId: string,
    id: string,
    details: {
      deviceNumber?: string;
      imei?: string;
      simNumber?: string;
      iccid?: string;
      provider?: string;
      model?: string;
      installedAt?: string;
    },
  ) {
    const device = await this.prisma.ioTDevice.findFirst({
      where: { id, clientId },
      select: { id: true },
    });
    if (!device) throw new NotFoundException('IoT device not found.');
    try {
      return await this.prisma.ioTDevice.update({
        where: { id },
        data: {
          deviceNumber: details.deviceNumber?.trim() || undefined,
          imei:
            details.imei === undefined ? undefined : details.imei.trim() || null,
          simNumber:
            details.simNumber === undefined
              ? undefined
              : details.simNumber.trim() || null,
          iccid:
            details.iccid === undefined
              ? undefined
              : details.iccid.trim() || null,
          provider:
            details.provider === undefined
              ? undefined
              : details.provider.trim() || null,
          model:
            details.model === undefined
              ? undefined
              : details.model.trim() || null,
          installedAt:
            details.installedAt === undefined
              ? undefined
              : details.installedAt
                ? new Date(details.installedAt)
                : null,
        },
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Device number is already registered.');
      }
      throw error;
    }
  }

  async ingest(
    deviceNumber: string,
    ingestSecret: string,
    type: TelemetryPacketType,
    payload: TelemetryPacket,
  ) {
    const device = await this.prisma.ioTDevice.findFirst({
      where: { deviceNumber, status: IoTDeviceStatus.ACTIVE },
      include: { currentFleet: { select: { id: true } } },
    });
    if (!device) throw new NotFoundException('Device not found.');
    if (!this.matchesSecret(ingestSecret, device.ingestSecretHash)) {
      throw new UnauthorizedException('Invalid device credentials.');
    }
    if (!device.currentFleet) {
      throw new NotFoundException('Device is not assigned to a fleet.');
    }

    const occurredAt = payload.occurredAt
      ? new Date(payload.occurredAt)
      : new Date();
    const fleetId = device.currentFleet.id;
    await this.prisma.vehicleCurrentState.upsert({
      where: { fleetId },
      create: {
        clientId: device.clientId,
        fleetId,
        iotDeviceId: device.id,
        latitude: payload.latitude,
        longitude: payload.longitude,
        speedKph: payload.speedKph,
        ignition: payload.ignition,
        lastHeartbeatAt: type === 'HEARTBEAT' ? occurredAt : undefined,
        lastLocationAt: type === 'LOCATION' ? occurredAt : undefined,
        isOnline: true,
      },
      update: {
        latitude: payload.latitude,
        longitude: payload.longitude,
        speedKph: payload.speedKph,
        ignition: payload.ignition,
        lastHeartbeatAt: type === 'HEARTBEAT' ? occurredAt : undefined,
        lastLocationAt: type === 'LOCATION' ? occurredAt : undefined,
        isOnline: true,
      },
    });
    await this.prisma.ioTDevice.update({
      where: { id: device.id },
      data: {
        lastHeartbeatAt: type === 'HEARTBEAT' ? occurredAt : undefined,
        lastLocationAt: type === 'LOCATION' ? occurredAt : undefined,
      },
    });
    if (type === 'START' || type === 'STOP') {
      await this.prisma.telemetryEvent.create({
        data: {
          clientId: device.clientId,
          fleetId,
          deviceId: device.id,
          type,
          occurredAt,
          payload: payload as Prisma.InputJsonValue,
        },
      });
    }
    return { fleetId };
  }

  private hashSecret(value: string): string {
    return createHmac('sha256', this.config.getOrThrow('OTP_HASH_SECRET'))
      .update(value)
      .digest('hex');
  }

  private matchesSecret(value: string, expectedHash: string): boolean {
    const actual = Buffer.from(this.hashSecret(value), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }
}
