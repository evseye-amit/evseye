import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClientContextService } from '../auth/client-context.service.js';

export interface ExchangeHubRequest {
  user: AuthUser;
  method: string;
  params?: { id?: string };
  body?: unknown;
  exchangeHubFilter?: Prisma.VehicleExchangeRequestWhereInput;
  exchangeHubIds?: string[];
}

@Injectable()
export class ExchangeHubGuard implements CanActivate {
  constructor(
    private readonly db: PrismaService,
    private readonly clients: ClientContextService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<ExchangeHubRequest>();
    const actor = request.user;
    if (
      !actor.roles.includes(UserRole.FLEET_MANAGER) ||
      actor.roles.some(
        (role) =>
          role === UserRole.CLIENT_ADMIN ||
          role === UserRole.OPERATIONS_MANAGER,
      )
    )
      return true;
    const clientId = this.clients.requireClientId(actor);
    const assignments = await this.db.userHub.findMany({
      where: {
        clientId,
        userId: actor.id,
        hub: { clientId, status: 'ACTIVE', deletedAt: null },
      },
      select: { hubId: true },
    });
    const hubIds = [...new Set(assignments.map((row) => row.hubId))];
    const fleets = hubIds.length
      ? await this.db.fleet.findMany({
          where: { clientId, currentHubId: { in: hubIds }, deletedAt: null },
          select: { id: true },
        })
      : [];
    // The actual submission hub takes precedence over the planned hub. Older
    // requests without either fall back to the original scooter's current hub.
    const scope: Prisma.VehicleExchangeRequestWhereInput = {
      OR: [
        { vehicleSubmission: { is: { clientId, hubId: { in: hubIds } } } },
        { vehicleSubmission: { is: null }, plannedHubId: { in: hubIds } },
        {
          vehicleSubmission: { is: null },
          plannedHubId: null,
          oldVehicleId: { in: fleets.map((fleet) => fleet.id) },
        },
      ],
    };
    request.exchangeHubFilter = scope;
    request.exchangeHubIds = hubIds;
    const id = request.params?.id;
    if (!id) return true; // List results are restricted by the same database filter.
    const exchange = await this.db.vehicleExchangeRequest.findFirst({
      where: { id, clientId, AND: scope },
      select: { id: true, replacementVehicleId: true },
    });
    if (!exchange)
      throw new NotFoundException(
        'Exchange request not found in your assigned hubs.',
      );
    if (request.method === 'GET') return true;
    const selected =
      request.body &&
      typeof request.body === 'object' &&
      !Array.isArray(request.body)
        ? (request.body as Record<string, unknown>)
        : {};
    // A request in an assigned hub must not allow actions on a replacement in
    // another hub. Client Admin/Operations Manager retains cross-hub authority.
    for (const vehicleId of new Set(
      [
        exchange.replacementVehicleId,
        typeof selected.vehicleId === 'string' ? selected.vehicleId : null,
      ].filter((value): value is string => Boolean(value)),
    )) {
      const fleet = await this.db.fleet.findFirst({
        where: {
          id: vehicleId,
          clientId,
          currentHubId: { in: hubIds },
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!fleet)
        throw new ForbiddenException(
          'The replacement scooter must belong to one of your assigned hubs.',
        );
    }
    if (typeof selected.hubId === 'string' && !hubIds.includes(selected.hubId))
      throw new ForbiddenException(
        'The replacement hub must be one of your assigned hubs.',
      );
    return true;
  }
}
