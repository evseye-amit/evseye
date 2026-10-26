import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ClientContextService } from '../client-context.service.js';
import type { AuthUser } from '../interfaces/auth-user.interface.js';

const RESOURCE = 'fleet-action-resource';
export const FleetActionResource = (
  resource:
    | 'fleet'
    | 'inspection'
    | 'media'
    | 'return'
    | 'exchange'
    | 'submission'
    | 'report',
) => SetMetadata(RESOURCE, resource);

/** Global search grants visibility only. Existing mutation routes still require an active assigned hub. */
@Injectable()
export class FleetManagerActionGuard implements CanActivate {
  constructor(
    private readonly db: PrismaService,
    private readonly clients: ClientContextService,
    private readonly reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{
      method: string;
      user: AuthUser;
      params?: Record<string, string>;
      body?: Record<string, unknown>;
    }>();
    const actor = request.user;
    if (
      ['GET', 'HEAD', 'OPTIONS'].includes(request.method) ||
      !actor?.roles.includes('FLEET_MANAGER') ||
      actor.roles.some(
        (r) => r === 'CLIENT_ADMIN' || r === 'FLEET_MANAGER',
      )
    )
      return true;
    const clientId = this.clients.requireClientId(actor);
    const hubs = (
      await this.db.userHub.findMany({
        where: {
          clientId,
          userId: actor.id,
          hub: { clientId, status: 'ACTIVE', deletedAt: null },
        },
        select: { hubId: true },
      })
    ).map((h) => h.hubId);
    const deny = () => {
      throw new ForbiddenException({
        code: 'FLEET_HUB_ACCESS_REQUIRED',
        message:
          'You can take action only on scooters in your active assigned hubs.',
      });
    };
    const ids = new Set<string>();
    const add = (id: unknown) => {
      if (typeof id === 'string' && id.trim()) ids.add(id.trim());
    };
    const params = request.params ?? {};
    const body = request.body ?? {};
    const resource = this.reflector.getAllAndOverride<string>(RESOURCE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (resource === 'return' && params.id) {
      const row = await this.db.rentalTerminationRequest.findFirst({
        where: { id: params.id, clientId },
        select: {
          allocation: { select: { fleetId: true } },
          agreement: { select: { currentVehicleId: true, vehicleId: true } },
        },
      });
      add(
        row?.allocation?.fleetId ??
          row?.agreement.currentVehicleId ??
          row?.agreement.vehicleId,
      );
    } else if (resource === 'exchange') {
      const row = await this.db.vehicleExchangeRequest.findFirst({
        where: { id: params.id, clientId },
        select: { oldVehicleId: true },
      });
      add(row?.oldVehicleId);
    } else if (resource === 'submission') {
      const row = await this.db.vehicleSubmission.findFirst({
        where: { id: params.id, clientId },
        select: { fleetId: true },
      });
      add(row?.fleetId);
    } else if (resource === 'report') {
      const row = await this.db.vehicleSubmissionReport.findFirst({
        where: { id: params.id, clientId },
        select: { submission: { select: { fleetId: true } } },
      });
      add(row?.submission.fleetId);
    } else if (resource === 'inspection') {
      const inspection = await this.db.inspection.findFirst({
        where: { id: params.id, clientId },
        select: { allocation: { select: { fleetId: true } } },
      });
      add(inspection?.allocation.fleetId);
    } else if (resource === 'media') {
      const entity = params.id
        ? await this.db.photo.findFirst({
            where: { id: params.id, clientId },
            select: { entityId: true, entityType: true },
          })
        : body;
      if (entity?.entityType === 'FLEET') add(entity.entityId);
      else if (
        entity?.entityType === 'INSPECTION' &&
        typeof entity.entityId === 'string'
      ) {
        const inspection = await this.db.inspection.findFirst({
          where: { id: entity.entityId, clientId },
          select: { allocation: { select: { fleetId: true } } },
        });
        add(inspection?.allocation.fleetId);
      } else if (
        entity &&
        typeof entity.entityId === 'string' &&
        ['BATTERY', 'CONTROLLER', 'IOT_DEVICE'].includes(
          String(entity.entityType),
        )
      ) {
        const link: Prisma.FleetWhereInput =
          entity.entityType === 'BATTERY'
            ? {
                batteryHistory: {
                  some: { batteryId: entity.entityId, removedAt: null },
                },
              }
            : entity.entityType === 'CONTROLLER'
              ? {
                  controllerHistory: {
                    some: { controllerId: entity.entityId, removedAt: null },
                  },
                }
              : { iotDeviceId: entity.entityId };
        const fleets = await this.db.fleet.findMany({
          where: { clientId, deletedAt: null, ...link },
          select: { id: true },
        });
        fleets.forEach((fleet) => add(fleet.id));
      } else return true;
    } else if (resource === 'fleet') {
      add(params.id);
      add(params.fleetId);
      add(body.fleetId);
      const rows = [
        body,
        ...(Array.isArray(body.rows)
          ? body.rows.filter(
              (r): r is Record<string, unknown> =>
                !!r && typeof r === 'object' && !Array.isArray(r),
            )
          : []),
      ];
      const alternatives: Prisma.FleetWhereInput[] = [];
      const strings = (value: unknown) =>
        Array.isArray(value)
          ? value
              .filter((v): v is string => typeof v === 'string')
              .map((v) => v.trim())
              .filter(Boolean)
          : typeof value === 'string' && value.trim()
            ? [value.trim()]
            : [];
      for (const row of rows) {
        // Bulk import services coerce values to strings. Reject non-scalar identifiers
        // before that coercion can resolve a different scooter than the access check.
        for (const key of [
          'fleetId',
          'fleetCode',
          'chassisNumber',
          'homeHubId',
          'currentHubId',
          'homeHubCode',
          'currentHubCode',
          'battery1Serial',
          'battery2Serial',
          'controllerId',
          'controllerNumber',
          'iotDeviceId',
          'iotDeviceNumber',
        ]) {
          if (row[key] != null && typeof row[key] !== 'string') deny();
        }
        for (const key of ['fleetId', 'fleetCode', 'chassisNumber'] as const)
          for (const value of strings(row[key]))
            alternatives.push({
              [key === 'fleetId' ? 'id' : key]: {
                equals: value,
                mode: 'insensitive',
              },
            });
        for (const key of ['homeHubId', 'currentHubId'] as const)
          for (const value of strings(row[key]))
            if (!hubs.includes(value)) deny();
        for (const key of ['homeHubCode', 'currentHubCode'])
          for (const value of strings(row[key])) {
            const hub = await this.db.hub.findFirst({
              where: { clientId, code: { equals: value, mode: 'insensitive' } },
              select: { id: true },
            });
            if (!hub || !hubs.includes(hub.id)) deny();
          }
        const batteries = [
          ...strings(row.batteryIds),
          ...strings(row.battery1Serial),
          ...strings(row.battery2Serial),
          ...strings(params.batteryId),
        ];
        const controllers = [
          ...strings(row.controllerId),
          ...strings(row.controllerNumber),
          ...strings(params.controllerId),
        ];
        const devices = [
          ...strings(row.iotDeviceId),
          ...strings(row.iotDeviceNumber),
        ];
        if (batteries.length)
          alternatives.push({
            batteryHistory: {
              some: {
                removedAt: null,
                battery: {
                  clientId,
                  OR: [
                    { id: { in: batteries } },
                    ...batteries.map((v) => ({
                      serialNumber: { equals: v, mode: 'insensitive' as const },
                    })),
                  ],
                },
              },
            },
          });
        if (controllers.length)
          alternatives.push({
            controllerHistory: {
              some: {
                removedAt: null,
                controller: {
                  clientId,
                  OR: [
                    { id: { in: controllers } },
                    ...controllers.map((v) => ({
                      controllerNumber: {
                        equals: v,
                        mode: 'insensitive' as const,
                      },
                    })),
                  ],
                },
              },
            },
          });
        if (devices.length)
          alternatives.push({
            iotDevice: {
              clientId,
              OR: [
                { id: { in: devices } },
                ...devices.map((v) => ({
                  deviceNumber: { equals: v, mode: 'insensitive' as const },
                })),
              ],
            },
          });
      }
      if (alternatives.length) {
        const fleets = await this.db.fleet.findMany({
          where: { clientId, deletedAt: null, OR: alternatives },
          select: { id: true, currentHubId: true },
        });
        for (const fleet of fleets) {
          if (!fleet.currentHubId || !hubs.includes(fleet.currentHubId)) deny();
          add(fleet.id);
        }
      }
    }
    if (ids.size) {
      const allowed = await this.db.fleet.count({
        where: {
          clientId,
          deletedAt: null,
          id: { in: [...ids] },
          currentHubId: { in: hubs },
        },
      });
      if (allowed !== ids.size) deny();
    }
    return true;
  }
}
