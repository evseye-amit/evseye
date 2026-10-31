import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ImportEntityType, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

const clientAdminEntities = new Set<ImportEntityType>([
  ImportEntityType.HUB,
  ImportEntityType.FLEET,
  ImportEntityType.RIDER,
  ImportEntityType.TEAM_LEADER,
  ImportEntityType.FLEET_MANAGER,
  ImportEntityType.BATTERY,
  ImportEntityType.CONTROLLER,
  ImportEntityType.IOT_DEVICE,
]);

@Injectable()
export class ImportAuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  async authorizeJob(input: {
    jobId: string;
    clientId: string;
    entityType: ImportEntityType;
    role: UserRole;
  }) {
    const job = await this.prisma.importJob.findFirst({
      where: { id: input.jobId, clientId: input.clientId },
      select: { id: true, clientId: true, entityType: true, originalFilename: true, metadata: true },
    });
    if (!job) throw new NotFoundException('Import job not found.');
    if (job.entityType !== input.entityType) throw new ForbiddenException('Import job entity type does not match the retry operation.');
    if (input.role !== UserRole.CLIENT_ADMIN && input.role !== UserRole.FLEET_MANAGER)
      throw new ForbiddenException('This role cannot retry imports.');
    if (!clientAdminEntities.has(job.entityType)) throw new ForbiddenException('This import entity cannot be retried from the client application.');
    return job;
  }
}
