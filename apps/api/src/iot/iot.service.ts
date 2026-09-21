import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ImportEntityType, ImportStatus, IoTDeviceStatus, Prisma } from '@prisma/client';
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
    fleetId: string | undefined,
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
    const fleet = fleetId
      ? await this.prisma.fleet.findFirst({
          where: { id: fleetId, clientId, deletedAt: null },
          select: { id: true, status: true, iotDeviceId: true },
        })
      : null;
    if (fleetId && !fleet) throw new NotFoundException('Fleet not found.');
    if (fleet?.status === 'OUT_OF_SERVICE') {
      throw new BadRequestException('IoT device cannot be assigned to an out-of-service Fleet.');
    }
    if (fleet?.iotDeviceId) {
      throw new ConflictException('Fleet already has an assigned IoT device. De-assign it before assigning another device.');
    }

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
          status: fleet ? IoTDeviceStatus.ACTIVE : IoTDeviceStatus.UNASSIGNED,
          installedAt: details?.installedAt
            ? new Date(details.installedAt)
            : undefined,
          activatedAt: fleet ? new Date() : undefined,
        },
      });
      if (fleet) {
        await this.prisma.fleet.update({
          where: { id: fleet.id },
          data: { iotDeviceId: device.id },
        });
      }
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

  async bulkRegisterDevices(clientId: string, actorId: string, filename: string, rows: Array<Record<string, unknown>>) {
    const fleets = await this.prisma.fleet.findMany({ where: { clientId, deletedAt: null }, select: { id: true, fleetCode: true, chassisNumber: true, status: true, iotDeviceId: true } });
    const fleetByReference = new Map<string, typeof fleets[number]>();
    fleets.forEach((fleet) => { fleetByReference.set(fleet.id.toUpperCase(), fleet); if (fleet.fleetCode) fleetByReference.set(fleet.fleetCode.toUpperCase(), fleet); fleetByReference.set(fleet.chassisNumber.toUpperCase(), fleet); });
    const failures: Array<Record<string, unknown>> = [];
    let created = 0;
    for (const [index, row] of rows.entries()) {
      const value = (field: string) => String(row[field] ?? '').trim();
      try {
        const suppliedReferences = [value('fleetId'), value('fleetCode'), value('chassisNumber')].filter(Boolean);
        const matchedFleets = suppliedReferences.map((reference) => fleetByReference.get(reference.toUpperCase()));
        if (matchedFleets.some((fleet) => !fleet)) throw new Error('fleetId, fleetCode, or chassisNumber does not match a Fleet.');
        if (matchedFleets.length > 1 && new Set(matchedFleets.map((fleet) => fleet?.id)).size > 1) throw new Error('Fleet references resolve to different Fleets.');
        const fleet = matchedFleets[0];
        if (fleet?.status === 'OUT_OF_SERVICE') throw new Error('IoT device cannot be assigned to an out-of-service Fleet.');
        if (fleet?.iotDeviceId) throw new Error('Fleet already has an assigned IoT device.');
        if (!value('deviceNumber')) throw new Error('deviceNumber is required.');
        await this.registerDevice(clientId, fleet?.id, value('deviceNumber'), { imei: value('imei') || undefined, simNumber: value('simNumber') || undefined, iccid: value('iccid') || undefined, provider: value('provider') || undefined, model: value('model') || undefined, installedAt: value('installedAt') || undefined });
        created += 1;
      } catch (error) { failures.push({ ...row, row_number: index + 2, failure_reason: error instanceof Error ? error.message : 'Invalid row.' }); }
    }
    const failedRows = failures.length;
    const job = await this.prisma.importJob.create({ data: { clientId, createdById: actorId, entityType: ImportEntityType.IOT_DEVICE, originalFilename: filename, totalRows: rows.length, passedRows: created, failedRows, createdRows: created, status: !created ? ImportStatus.FAIL : failedRows ? ImportStatus.PARTIAL_PASS : ImportStatus.PASS, completedAt: new Date(), metadata: JSON.parse(JSON.stringify({ failures })) } });
    return { jobId: job.id, status: job.status, totalRows: rows.length, passedRows: created, failedRows, createdRows: created };
  }

  async failedRows(clientId: string, jobId: string) {
    const job = await this.prisma.importJob.findFirst({ where: { id: jobId, clientId, entityType: ImportEntityType.IOT_DEVICE }, select: { metadata: true } });
    if (!job) throw new NotFoundException('Import job not found.');
    return ((job.metadata as { failures?: Array<Record<string, unknown>> } | null)?.failures) ?? [];
  }

  async updateDevice(
    clientId: string,
    id: string,
    details: {
      fleetId?: string | null;
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
      select: { id: true, currentFleet: { select: { id: true } } },
    });
    if (!device) throw new NotFoundException('IoT device not found.');
    const requestedFleetId = details.fleetId === undefined ? undefined : details.fleetId || null;
    const fleet = requestedFleetId
      ? await this.prisma.fleet.findFirst({
          where: { id: requestedFleetId, clientId, deletedAt: null },
          select: { id: true, status: true, iotDeviceId: true },
        })
      : null;
    if (requestedFleetId && !fleet) throw new NotFoundException('Fleet not found.');
    if (fleet?.status === 'OUT_OF_SERVICE') throw new BadRequestException('IoT device cannot be assigned to an out-of-service Fleet.');
    if (fleet?.iotDeviceId && fleet.iotDeviceId !== id) throw new ConflictException('Fleet already has an assigned IoT device.');
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (requestedFleetId !== undefined && device.currentFleet?.id && device.currentFleet.id !== requestedFleetId) {
          await tx.fleet.update({ where: { id: device.currentFleet.id }, data: { iotDeviceId: null } });
        }
        if (fleet && device.currentFleet?.id !== fleet.id) {
          await tx.fleet.update({ where: { id: fleet.id }, data: { iotDeviceId: id } });
        }
        return tx.ioTDevice.update({
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
            status: requestedFleetId === undefined ? undefined : fleet ? IoTDeviceStatus.ACTIVE : IoTDeviceStatus.UNASSIGNED,
            activatedAt: requestedFleetId === undefined ? undefined : fleet ? new Date() : null,
          },
        });
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
