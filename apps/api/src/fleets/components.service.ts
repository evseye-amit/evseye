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
  ImportEntityType,
  ImportStatus,
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
  listControllers(clientId: string) {
    return this.prisma.controller.findMany({
      where: { clientId, deletedAt: null },
      include: {
        fleetHistory: {
          where: { removedAt: null },
          select: {
            installedAt: true,
            fleet: { select: { id: true, fleetCode: true, vehicleNumber: true } },
          },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  listMappings(clientId: string) {
    return this.prisma.fleet.findMany({
      where: { clientId, deletedAt: null },
      select: {
        id: true, fleetCode: true, vehicleNumber: true, chassisNumber: true,
        iotDevice: { select: { id: true, deviceNumber: true, status: true } },
        batteryHistory: { where: { removedAt: null }, select: { battery: { select: { id: true, batteryCode: true, serialNumber: true } } } },
        controllerHistory: { where: { removedAt: null }, select: { controller: { select: { id: true, controllerNumber: true } } } },
      },
      orderBy: { fleetCode: 'asc' },
    });
  }
  async saveMapping(
    clientId: string,
    data: { fleetId: string; iotDeviceId?: string | null; batteryIds?: string[]; controllerId?: string | null },
  ) {
    await this.fleet(clientId, data.fleetId);
    if ((data.batteryIds?.length ?? 0) > 2) throw new ConflictException('A Fleet can have a maximum of two Batteries.');
    return this.prisma.$transaction(async (tx) => {
      if (data.iotDeviceId !== undefined) {
        if (data.iotDeviceId) {
          const device = await tx.ioTDevice.findFirst({ where: { id: data.iotDeviceId, clientId }, select: { id: true } });
          if (!device) throw new NotFoundException('IoT device not found.');
          await tx.fleet.updateMany({ where: { clientId, iotDeviceId: device.id }, data: { iotDeviceId: null } });
        }
        await tx.fleet.update({ where: { id: data.fleetId }, data: { iotDeviceId: data.iotDeviceId || null } });
        if (data.iotDeviceId) await tx.ioTDevice.update({ where: { id: data.iotDeviceId }, data: { status: 'ACTIVE', activatedAt: new Date() } });
      }
      if (data.batteryIds !== undefined) {
        const batteries = data.batteryIds.length ? await tx.battery.findMany({ where: { id: { in: data.batteryIds }, clientId, deletedAt: null }, select: { id: true } }) : [];
        if (batteries.length !== data.batteryIds.length) throw new NotFoundException('One or more Batteries were not found.');
        const current = await tx.fleetBatteryHistory.findMany({ where: { fleetId: data.fleetId, removedAt: null }, select: { id: true, batteryId: true } });
        if (current.length) await tx.fleetBatteryHistory.updateMany({ where: { id: { in: current.map((item) => item.id) } }, data: { removedAt: new Date(), reason: 'Updated through Fleet Component Mapping.' } });
        if (current.length) await tx.battery.updateMany({ where: { id: { in: current.map((item) => item.batteryId) } }, data: { status: BatteryStatus.AVAILABLE } });
        for (const [index, batteryId] of data.batteryIds.entries()) {
          await tx.fleetBatteryHistory.updateMany({ where: { batteryId, removedAt: null }, data: { removedAt: new Date(), reason: 'Mapped to another Fleet.' } });
          await tx.battery.update({ where: { id: batteryId }, data: { status: BatteryStatus.INSTALLED } });
          await tx.fleetBatteryHistory.create({ data: { fleetId: data.fleetId, batteryId, batterySlot: index === 0 ? BatterySlot.PRIMARY : BatterySlot.SECONDARY, installedAt: new Date() } });
        }
      }
      if (data.controllerId !== undefined) {
        const current = await tx.fleetControllerHistory.findMany({ where: { fleetId: data.fleetId, removedAt: null }, select: { id: true, controllerId: true } });
        if (current.length) await tx.fleetControllerHistory.updateMany({ where: { id: { in: current.map((item) => item.id) } }, data: { removedAt: new Date(), reason: 'Updated through Fleet Component Mapping.' } });
        if (current.length) await tx.controller.updateMany({ where: { id: { in: current.map((item) => item.controllerId) } }, data: { status: ControllerStatus.AVAILABLE } });
        if (data.controllerId) {
          const controller = await tx.controller.findFirst({ where: { id: data.controllerId, clientId, deletedAt: null }, select: { id: true } });
          if (!controller) throw new NotFoundException('Controller not found.');
          await tx.fleetControllerHistory.updateMany({ where: { controllerId: controller.id, removedAt: null }, data: { removedAt: new Date(), reason: 'Mapped to another Fleet.' } });
          await tx.controller.update({ where: { id: controller.id }, data: { status: ControllerStatus.INSTALLED } });
          await tx.fleetControllerHistory.create({ data: { fleetId: data.fleetId, controllerId: controller.id, installedAt: new Date() } });
        }
      }
      return tx.fleet.findUniqueOrThrow({ where: { id: data.fleetId }, select: { id: true, fleetCode: true } });
    });
  }

  async bulkSaveMappings(clientId: string, actorId: string, filename: string, rows: Array<Record<string, unknown>>) {
    const [fleets, devices, batteries, controllers] = await Promise.all([
      this.prisma.fleet.findMany({ where: { clientId, deletedAt: null }, select: { id: true, fleetCode: true, chassisNumber: true } }),
      this.prisma.ioTDevice.findMany({ where: { clientId }, select: { id: true, deviceNumber: true } }),
      this.prisma.battery.findMany({ where: { clientId, deletedAt: null }, select: { id: true, serialNumber: true } }),
      this.prisma.controller.findMany({ where: { clientId, deletedAt: null }, select: { id: true, controllerNumber: true } }),
    ]);
    const index = <T extends { id: string }>(records: T[], key: (record: T) => string) => new Map(records.map((record) => [key(record).toUpperCase(), record.id]));
    const fleetReferences = new Map<string, string>(); fleets.forEach((fleet) => { fleetReferences.set(fleet.id.toUpperCase(), fleet.id); fleetReferences.set(fleet.fleetCode.toUpperCase(), fleet.id); fleetReferences.set(fleet.chassisNumber.toUpperCase(), fleet.id); });
    const deviceReferences = index(devices, (device) => device.deviceNumber); const batteryReferences = index(batteries, (battery) => battery.serialNumber); const controllerReferences = index(controllers, (controller) => controller.controllerNumber);
    const failures: Array<Record<string, unknown>> = []; let passedRows = 0;
    for (const [rowIndex, row] of rows.entries()) {
      const value = (field: string) => String(row[field] ?? '').trim();
      try {
        const fleet = fleetReferences.get((value('fleetId') || value('fleetCode') || value('chassisNumber')).toUpperCase());
        if (!fleet) throw new Error('fleetId, fleetCode, or chassisNumber is required and must match a Fleet.');
        const batteryIds = [value('battery1Serial'), value('battery2Serial')].filter(Boolean).map((serial) => batteryReferences.get(serial.toUpperCase()));
        if (batteryIds.some((id) => !id)) throw new Error('Battery serial number does not match a Battery.');
        const device = value('iotDeviceNumber') ? deviceReferences.get(value('iotDeviceNumber').toUpperCase()) : undefined;
        const controller = value('controllerNumber') ? controllerReferences.get(value('controllerNumber').toUpperCase()) : undefined;
        if (value('iotDeviceNumber') && !device) throw new Error('IoT device number does not match an IoT device.');
        if (value('controllerNumber') && !controller) throw new Error('Controller number does not match a Controller.');
        await this.saveMapping(clientId, { fleetId: fleet, iotDeviceId: device ?? null, batteryIds: batteryIds as string[], controllerId: controller ?? null }); passedRows += 1;
      } catch (error) { failures.push({ ...row, row_number: rowIndex + 2, failure_reason: error instanceof Error ? error.message : 'Invalid row.' }); }
    }
    const failedRows = failures.length;
    const job = await this.prisma.importJob.create({ data: { clientId, createdById: actorId, entityType: ImportEntityType.FLEET_COMPONENT_MAPPING, originalFilename: filename, totalRows: rows.length, passedRows, failedRows, createdRows: passedRows, status: !passedRows ? ImportStatus.FAIL : failedRows ? ImportStatus.PARTIAL_PASS : ImportStatus.PASS, completedAt: new Date(), metadata: JSON.parse(JSON.stringify({ failures })) } });
    return { jobId: job.id, status: job.status, totalRows: rows.length, passedRows, failedRows, createdRows: passedRows };
  }
  private async fleet(clientId: string, fleetId: string) {
    const f = await this.prisma.fleet.findFirst({
      where: { id: fleetId, clientId, deletedAt: null },
    });
    if (!f) throw new NotFoundException('Fleet not found.');
    if (f.status === 'OUT_OF_SERVICE') throw new ConflictException('Component cannot be assigned to an out-of-service Fleet.');
  }
  async addBattery(
    clientId: string,
    fleetId: string | undefined,
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
    if (fleetId) await this.fleet(clientId, fleetId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const batterySlot = data.batterySlot ?? BatterySlot.PRIMARY;
        const replaced = fleetId ? await tx.fleetBatteryHistory.findMany({
          where: { fleetId, batterySlot, removedAt: null },
          select: { id: true, batteryId: true },
        }) : [];
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
            status: fleetId ? BatteryStatus.INSTALLED : BatteryStatus.AVAILABLE,
          },
        });
        if (fleetId) await tx.fleetBatteryHistory.create({
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
    fleetId: string | undefined,
    data: {
      controllerNumber: string;
      manufacturer?: string;
      model?: string;
      ratedVoltage?: number;
      ratedCurrent?: number;
    },
  ) {
    if (fleetId) await this.fleet(clientId, fleetId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const replaced = fleetId ? await tx.fleetControllerHistory.findMany({
          where: { fleetId, removedAt: null },
          select: { id: true, controllerId: true },
        }) : [];
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
            status: fleetId ? ControllerStatus.INSTALLED : ControllerStatus.AVAILABLE,
          },
        });
        if (fleetId) await tx.fleetControllerHistory.create({
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

  async bulkCreate(
    clientId: string,
    actorId: string,
    filename: string,
    kind: 'BATTERY' | 'CONTROLLER',
    rows: Array<Record<string, unknown>>,
  ) {
    const fleets = await this.prisma.fleet.findMany({
      where: { clientId, deletedAt: null },
      select: { id: true, fleetCode: true, chassisNumber: true },
    });
    const fleetByReference = new Map<string, string>();
    fleets.forEach((fleet) => {
      fleetByReference.set(fleet.id.toUpperCase(), fleet.id);
      if (fleet.fleetCode) fleetByReference.set(fleet.fleetCode.toUpperCase(), fleet.id);
      fleetByReference.set(fleet.chassisNumber.toUpperCase(), fleet.id);
    });
    const failures: Array<Record<string, unknown>> = [];
    let created = 0;
    for (const [index, row] of rows.entries()) {
      const value = (field: string) => String(row[field] ?? '').trim();
      try {
        const suppliedReferences = [value('fleetId'), value('fleetCode'), value('chassisNumber')].filter(Boolean);
        const matches = suppliedReferences.map((reference) => fleetByReference.get(reference.toUpperCase()));
        if (matches.some((id) => !id)) throw new Error('fleetId, fleetCode, or chassisNumber does not match a Fleet.');
        if (matches.length > 1 && new Set(matches).size > 1) throw new Error('Fleet references resolve to different Fleets.');
        const fleetId = matches[0];
        if (kind === 'BATTERY') {
          if (!value('serialNumber')) throw new Error('serialNumber is required.');
          await this.addBattery(clientId, fleetId, {
            serialNumber: value('serialNumber'), batteryCode: value('batteryCode') || undefined,
            batteryType: value('batteryType') as BatteryType || undefined,
            batterySlot: value('batterySlot') as BatterySlot || undefined,
            manufacturer: value('manufacturer') || undefined, model: value('model') || undefined,
            chemistry: value('chemistry') as BatteryChemistry || undefined,
            capacityKwh: value('capacityKwh') ? Number(value('capacityKwh')) : undefined,
            voltage: value('voltage') ? Number(value('voltage')) : undefined,
            ampHour: value('ampHour') ? Number(value('ampHour')) : undefined,
            installedOdometerKm: value('installedOdometerKm') ? Number(value('installedOdometerKm')) : undefined,
            manufacturingDate: value('manufacturingDate') || undefined,
            warrantyStartDate: value('warrantyStartDate') || undefined,
            warrantyEndDate: value('warrantyEndDate') || undefined,
          });
        } else {
          if (!value('controllerNumber')) throw new Error('controllerNumber is required.');
          await this.addController(clientId, fleetId, {
            controllerNumber: value('controllerNumber'), manufacturer: value('manufacturer') || undefined,
            model: value('model') || undefined,
            ratedVoltage: value('ratedVoltage') ? Number(value('ratedVoltage')) : undefined,
            ratedCurrent: value('ratedCurrent') ? Number(value('ratedCurrent')) : undefined,
          });
        }
        created += 1;
      } catch (error) {
        failures.push({ ...row, row_number: index + 2, failure_reason: error instanceof Error ? error.message : 'Invalid row.' });
      }
    }
    const failedRows = failures.length;
    const job = await this.prisma.importJob.create({
      data: { clientId, createdById: actorId, entityType: kind === 'BATTERY' ? ImportEntityType.BATTERY : ImportEntityType.CONTROLLER, originalFilename: filename, totalRows: rows.length, passedRows: created, failedRows, createdRows: created, status: !created ? ImportStatus.FAIL : failedRows ? ImportStatus.PARTIAL_PASS : ImportStatus.PASS, completedAt: new Date(), metadata: JSON.parse(JSON.stringify({ failures })) },
    });
    return { jobId: job.id, status: job.status, totalRows: rows.length, passedRows: created, failedRows, createdRows: created };
  }

  async failedRows(clientId: string, jobId: string, entityType: ImportEntityType) {
    const job = await this.prisma.importJob.findFirst({ where: { id: jobId, clientId, entityType }, select: { metadata: true } });
    if (!job) throw new NotFoundException('Import job not found.');
    return ((job.metadata as { failures?: Array<Record<string, unknown>> } | null)?.failures) ?? [];
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

  async updateStandaloneBattery(clientId: string, batteryId: string, data: Parameters<ComponentsService['addBattery']>[2]) {
    const existing = await this.prisma.battery.findFirst({ where: { id: batteryId, clientId, deletedAt: null }, select: { id: true } });
    if (!existing) throw new NotFoundException('Battery not found.');
    return this.prisma.battery.update({ where: { id: batteryId }, data: { serialNumber: data.serialNumber.trim().toUpperCase(), batteryCode: data.batteryCode?.trim() || null, batteryType: data.batteryType, manufacturer: data.manufacturer?.trim() || null, model: data.model?.trim() || null, chemistry: data.chemistry, capacityKwh: data.capacityKwh, voltage: data.voltage, ampHour: data.ampHour, manufacturingDate: data.manufacturingDate ? new Date(data.manufacturingDate) : null, warrantyStartDate: data.warrantyStartDate ? new Date(data.warrantyStartDate) : null, warrantyEndDate: data.warrantyEndDate ? new Date(data.warrantyEndDate) : null } });
  }

  async updateStandaloneController(clientId: string, controllerId: string, data: Parameters<ComponentsService['addController']>[2]) {
    const existing = await this.prisma.controller.findFirst({ where: { id: controllerId, clientId, deletedAt: null }, select: { id: true } });
    if (!existing) throw new NotFoundException('Controller not found.');
    return this.prisma.controller.update({ where: { id: controllerId }, data: { controllerNumber: data.controllerNumber.trim().toUpperCase(), manufacturer: data.manufacturer?.trim() || null, model: data.model?.trim() || null, ratedVoltage: data.ratedVoltage, ratedCurrent: data.ratedCurrent } });
  }
}
