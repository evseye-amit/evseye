import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { parseFirebaseServiceAccount } from '../config/firebase-credentials.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';

export type ConfigurePushBinding = {
  clientId: string;
  appCode: string;
  platform: string;
  applicationId: string;
  projectId: string;
  credentialReference: string;
};
@Injectable()
export class NotificationConfigurationService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
  ) {}
  async configure(actor: AuthUser, input: ConfigurePushBinding) {
    if (!actor.roles.includes('SUPER_ADMIN'))
      throw new ForbiddenException('Platform administrator required.');
    const environment =
      this.config.get<string>('PUSH_ENVIRONMENT') ?? 'development';
    try {
      const secret = this.config.get<string>(input.credentialReference);
      if (!secret) throw new Error();
      parseFirebaseServiceAccount(secret, input.projectId);
    } catch {
      throw new BadRequestException(
        'Firebase credential reference is unavailable or does not match the project.',
      );
    }
    return this.db.$transaction(async (tx) => {
      const client = await tx.client.findFirst({
        where: {
          id: input.clientId,
          isActive: true,
          status: { notIn: ['DRAFT', 'SUSPENDED'] },
        },
        select: { id: true },
      });
      if (!client) throw new BadRequestException('Client is unavailable.');
      const previous = await tx.firebaseProjectConfiguration.findUnique({
        where: {
          environment_projectId: { environment, projectId: input.projectId },
        },
      });
      const c = await tx.firebaseProjectConfiguration.upsert({
        where: {
          environment_projectId: { environment, projectId: input.projectId },
        },
        create: {
          environment,
          projectId: input.projectId,
          credentialReference: input.credentialReference,
        },
        update: {
          credentialReference: input.credentialReference,
          ...(previous &&
          previous.credentialReference !== input.credentialReference
            ? { credentialVersion: { increment: 1 } }
            : {}),
          isActive: true,
        },
      });
      const key = {
        clientId: input.clientId,
        appCode: input.appCode,
        platform: input.platform,
        applicationId: input.applicationId,
        environment,
      };
      const old = await tx.notificationAppBinding.findUnique({
        where: { clientId_appCode_platform_applicationId_environment: key },
      });
      if (old && old.firebaseConfigurationId !== c.id)
        throw new ConflictException(
          'An existing app binding cannot change Firebase project. Migrate installations explicitly.',
        );
      const binding = await tx.notificationAppBinding.upsert({
        where: { clientId_appCode_platform_applicationId_environment: key },
        create: { ...key, firebaseConfigurationId: c.id },
        update: { isActive: true },
      });
      await tx.auditLog.create({
        data: {
          clientId: input.clientId,
          actorId: actor.id,
          action: 'NOTIFICATION_FIREBASE_CONFIGURED',
          entityType: 'NotificationAppBinding',
          entityId: binding.id,
          newData: {
            projectId: input.projectId,
            environment,
            appCode: input.appCode,
            platform: input.platform,
            applicationId: input.applicationId,
            credentialVersion: c.credentialVersion,
          },
        },
      });
      return {
        id: binding.id,
        ...key,
        projectId: c.projectId,
        credentialVersion: c.credentialVersion,
        readiness: 'CREDENTIAL_VALIDATED',
        requiresDeviceRegistration: true,
      };
    });
  }
}
