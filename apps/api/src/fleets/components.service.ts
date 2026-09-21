import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BatteryChemistry,
  BatterySlot,
  BatteryStatus,
  BatteryType,
  ControllerStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
@Injectable()
export class ComponentsService {
  constructor(private readonly prisma: PrismaService) {}

  listBatteries(clientId: string) {
    return this.prisma.battery.findMany({
      where: { clientId, deletedAt: null },
      include: {
        fleetHistory: {
          where: { removedAt: null },
          select: {
            batterySlot: true,
            installedAt: true,
            fleet: {
              select: { id: true, fleetCode: true, vehicleNumber: true },
            },
          },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  private async fleet(clientId: string, fleetId: string) {
    const f = await this.prisma.fleet.findFirst({
      where: { id: fleetId, clientId, deletedAt: null },
    });
    if (!f) throw new NotFoundException('Fleet not found.');
  }
  async addBattery(
    clientId: string,
    fleetId: string,
    data: {
      serialNumber: string;
      batteryCode?: string;
      batteryType?: BatteryType;
      batterySlot?: BatterySlot;
      manufacturer?: string;
      model?: string;
      chemistry?: BatteryChemistry;
      capacityKwh?: number;
      voltage?: number;
      ampHour?: number;
      installedOdometerKm?: number;
      manufacturingDate?: string;
      warrantyStartDate?: string;
      warrantyEndDate?: string;
    },
  ) {
    await this.fleet(clientId, fleetId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const batterySlot = data.batterySlot ?? BatterySlot.PRIMARY;
        const replaced = await tx.fleetBatteryHistory.findMany({
          where: { fleetId, batterySlot, removedAt: null },
          select: { id: true, batteryId: true },
        });
        if (replaced.length) {
          const removedAt = new Date();
          await tx.fleetBatteryHistory.updateMany({
            where: { id: { in: replaced.map((item) => item.id) } },
            data: {
              removedAt,
              removedOdometerKm: data.installedOdometerKm,
              reason: 'Replaced during fleet onboarding.',
            },
          });
          await tx.battery.updateMany({
            where: { id: { in: replaced.map((item) => item.batteryId) } },
            data: { status: BatteryStatus.AVAILABLE },
          });
        }
        const battery = await tx.battery.create({
          data: {
            clientId,
            batteryCode: data.batteryCode,
            serialNumber: data.serialNumber.trim().toUpperCase(),
            batteryType: data.batteryType ?? BatteryType.FIXED_SINGLE,
            manufacturer: data.manufacturer,
            model: data.model,
            chemistry: data.chemistry,
            capacityKwh: data.capacityKwh,
            voltage: data.voltage,
            ampHour: data.ampHour,
            manufacturingDate: data.manufacturingDate
              ? new Date(data.manufacturingDate)
              : undefined,
            warrantyStartDate: data.warrantyStartDate
              ? new Date(data.warrantyStartDate)
              : undefined,
            warrantyEndDate: data.warrantyEndDate
              ? new Date(data.warrantyEndDate)
              : undefined,
            status: BatteryStatus.INSTALLED,
          },
        });
        await tx.fleetBatteryHistory.create({
          data: {
            fleetId,
            batteryId: battery.id,
            batterySlot,
            installedAt: new Date(),
            installedOdometerKm: data.installedOdometerKm,
          },
        });
        return battery;
      });
    } catch (e) {
      if (typeof e === 'object' && e && 'code' in e && e.code === 'P2002')
        throw new ConflictException('Battery serial number already exists.');
      throw e;
    }
  }
  async addController(
    clientId: string,
    fleetId: string,
    data: {
      controllerNumber: string;
      manufacturer?: string;
      model?: string;
      ratedVoltage?: number;
      ratedCurrent?: number;
    },
  ) {
    await this.fleet(clientId, fleetId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const replaced = await tx.fleetControllerHistory.findMany({
          where: { fleetId, removedAt: null },
          select: { id: true, controllerId: true },
        });
        if (replaced.length) {
          const removedAt = new Date();
          await tx.fleetControllerHistory.updateMany({
            where: { id: { in: replaced.map((item) => item.id) } },
            data: {
              removedAt,
              reason: 'Replaced during fleet onboarding.',
            },
          });
          await tx.controller.updateMany({
            where: { id: { in: replaced.map((item) => item.controllerId) } },
            data: { status: ControllerStatus.AVAILABLE },
          });
        }
        const controller = await tx.controller.create({
          data: {
            clientId,
            controllerNumber: data.controllerNumber.trim().toUpperCase(),
            manufacturer: data.manufacturer,
            model: data.model,
            ratedVoltage: data.ratedVoltage,
            ratedCurrent: data.ratedCurrent,
            status: ControllerStatus.INSTALLED,
          },
        });
        await tx.fleetControllerHistory.create({
          data: {
            fleetId,
            controllerId: controller.id,
            installedAt: new Date(),
          },
        });
        return controller;
      });
    } catch (e) {
      if (typeof e === 'object' && e && 'code' in e && e.code === 'P2002')
        throw new ConflictException('Controller serial number already exists.');
      throw e;
    }
  }

  async updateBattery(
    clientId: string,
    fleetId: string,
    batteryId: string,
    data: Parameters<ComponentsService['addBattery']>[2],
  ) {
    const installed = await this.prisma.fleetBatteryHistory.findFirst({
      where: { fleetId, batteryId, removedAt: null, battery: { clientId } },
      select: { id: true },
    });
    if (!installed) throw new NotFoundException('Installed battery not found.');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const battery = await tx.battery.update({
          where: { id: batteryId },
          data: {
            serialNumber: data.serialNumber.trim().toUpperCase(),
            batteryCode: data.batteryCode?.trim() || null,
            batteryType: data.batteryType,
            manufacturer: data.manufacturer?.trim() || null,
            model: data.model?.trim() || null,
            chemistry: data.chemistry,
            capacityKwh: data.capacityKwh,
            voltage: data.voltage,
            ampHour: data.ampHour,
            manufacturingDate: data.manufacturingDate
              ? new Date(data.manufacturingDate)
              : null,
            warrantyStartDate: data.warrantyStartDate
              ? new Date(data.warrantyStartDate)
              : null,
            warrantyEndDate: data.warrantyEndDate
              ? new Date(data.warrantyEndDate)
              : null,
          },
        });
        if (data.batterySlot) {
          await tx.fleetBatteryHistory.update({
            where: { id: installed.id },
            data: { batterySlot: data.batterySlot },
          });
        }
        return battery;
      });
    } catch (e) {
      if (typeof e === 'object' && e && 'code' in e && e.code === 'P2002')
        throw new ConflictException('Battery serial number or code already exists.');
      throw e;
    }
  }

  async updateController(
    clientId: string,
    fleetId: string,
    controllerId: string,
    data: Parameters<ComponentsService['addController']>[2],
  ) {
    const installed = await this.prisma.fleetControllerHistory.findFirst({
      where: {
        fleetId,
        controllerId,
        removedAt: null,
        controller: { clientId },
      },
      select: { id: true },
    });
    if (!installed)
      throw new NotFoundException('Installed controller not found.');
    try {
      return await this.prisma.controller.update({
        where: { id: controllerId },
        data: {
          controllerNumber: data.controllerNumber.trim().toUpperCase(),
          manufacturer: data.manufacturer?.trim() || null,
          model: data.model?.trim() || null,
          ratedVoltage: data.ratedVoltage,
          ratedCurrent: data.ratedCurrent,
        },
      });
    } catch (e) {
      if (typeof e === 'object' && e && 'code' in e && e.code === 'P2002')
        throw new ConflictException('Controller number already exists.');
      throw e;
    }
  }
}
