import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Prisma, UserRole } from '@prisma/client';
import { NotificationService } from './notification.service.js';
import { hash, verifyInstallationCredential } from './notification.helpers.js';
import type {
  EnrollInstallationDto,
  UpdateInstallationDto,
} from './notification-installation.dto.js';

@Injectable()
export class NotificationInstallationService {
  constructor(
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
  ) {}
  private async binding(tx: Prisma.TransactionClient, id: string) {
    const binding = await tx.notificationAppBinding.findFirst({
      where: {
        id,
        environment: this.config.get('PUSH_ENVIRONMENT') ?? 'development',
        isActive: true,
        appCode: { in: ['RIDER_APP', 'FLEET_MANAGER_APP', 'TEAM_LEADER_APP'] },
        firebaseConfiguration: { isActive: true },
        client: { isActive: true, status: { notIn: ['DRAFT', 'SUSPENDED'] } },
      },
    });
    if (!binding)
      throw new NotFoundException('Installation application is unavailable.');
    return binding;
  }
  async enroll(input: EnrollInstallationDto) {
    return this.notifications.transaction(async (tx) => {
      const binding = await this.binding(tx, input.bindingId);
      const credential = randomBytes(32).toString('base64url');
      const row = await tx.notificationInstallation.create({
        data: {
          id: randomUUID(),
          clientId: binding.clientId,
          bindingId: binding.id,
          credentialHash: hash(credential),
          token: input.token,
          tokenHash: input.token ? hash(input.token) : undefined,
          tokenUpdatedAt: input.token ? new Date() : undefined,
          firebaseInstallationId: input.firebaseInstallationId,
          permission: input.permission,
          onboardingState: input.onboardingState,
        },
      });
      return {
        installationId: row.id,
        installationCredential: credential,
        appCode: binding.appCode,
        permission: row.permission,
        lifecycle: row.onboardingState,
      };
    });
  }
  async claim(
    id: string,
    credential: string,
    actor: AuthUser,
    permission?: string,
  ) {
    return this.notifications.transaction(async (tx) => {
      const row = await tx.notificationInstallation.findUnique({
        where: { id },
      });
      if (!row || row.revokedAt)
        throw new UnauthorizedException('Invalid installation credential.');
      verifyInstallationCredential(row.credentialHash, credential);
      const binding = await this.binding(tx, row.bindingId);
      const roles: Record<string, string> = {
        RIDER_APP: 'RIDER',
        FLEET_MANAGER_APP: 'FLEET_MANAGER',
        TEAM_LEADER_APP: 'TEAM_LEAD',
      };
      if (actor.clientId !== row.clientId || !actor.sessionId)
        throw new ForbiddenException('Installation account mismatch.');
      const session = await tx.session.findFirst({
        where: {
          id: actor.sessionId,
          userId: actor.id,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          user: {
            clientId: row.clientId,
            role: roles[binding.appCode] as UserRole,
            isActive: true,
            deletedAt: null,
          },
        },
      });
      if (!session) throw new UnauthorizedException('Session is unavailable.');
      // A tokenless claim never activates or transfers an earlier account's token.
      if (
        row.userId !== actor.id ||
        row.sessionId !== actor.sessionId ||
        (permission !== undefined &&
          !['AUTHORIZED', 'PROVISIONAL'].includes(permission))
      )
        await tx.pushDevice.updateMany({
          where: { installationId: id, appCode: binding.appCode },
          data: {
            isActive: false,
            topicReconciledAt: null,
            version: { increment: 1 },
            disabledReason: 'AWAITING_DEVICE_REGISTRATION',
          },
        });
      await tx.notificationInstallation.update({
        where: { id },
        data: {
          userId: actor.id,
          sessionId: actor.sessionId,
          hasRegistered: true,
          ...(permission !== undefined ? { permission } : {}),
          lastActiveAt: new Date(),
        },
      });
      return {
        installationId: id,
        lifecycle: 'REGISTERED',
        permission: permission ?? row.permission,
        pushRegistrationRequired: true,
      };
    });
  }
  async access(
    id: string,
    credential: string | undefined,
    update?: UpdateInstallationDto,
    revoke = false,
  ) {
    return this.notifications.transaction(async (tx) => {
      const row = await tx.notificationInstallation.findUnique({
        where: { id },
        include: { session: true, user: true },
      });
      if (!row || row.revokedAt)
        throw new UnauthorizedException('Invalid installation credential.');
      verifyInstallationCredential(row.credentialHash, credential);
      const binding = await this.binding(tx, row.bindingId);
      const registered =
        !!row.session &&
        !!row.user &&
        row.session.userId === row.userId &&
        !row.session.revokedAt &&
        row.session.expiresAt > new Date() &&
        row.user.isActive &&
        !row.user.deletedAt;
      if (update && registered)
        throw new ConflictException(
          'Use authenticated device registration to update this installation.',
        );
      if (revoke || (update && row.hasRegistered))
        await tx.pushDevice.updateMany({
          where: {
            installationId: id,
            appCode: binding.appCode,
            clientId: row.clientId,
          },
          data: {
            isActive: false,
            topicReconciledAt: null,
            version: { increment: 1 },
            disabledReason: revoke ? 'INSTALLATION_REVOKED' : 'LOGGED_OUT',
          },
        });
      if (revoke) {
        await tx.notificationInstallation.update({
          where: { id },
          data: {
            userId: null,
            sessionId: null,
            revokedAt: new Date(),
            token: null,
            tokenHash: null,
            firebaseInstallationId: null,
          },
        });
        return { revoked: true };
      }
      const updated = await tx.notificationInstallation.update({
        where: { id },
        data: {
          ...(update && !registered ? { userId: null, sessionId: null } : {}),
          lastActiveAt: new Date(),
          ...(update
            ? {
                permission: update.permission,
                firebaseInstallationId: update.firebaseInstallationId,
                ...(!row.hasRegistered
                  ? { onboardingState: update.onboardingState }
                  : {}),
                ...(update.token
                  ? {
                      token: update.token,
                      tokenHash: hash(update.token),
                      tokenUpdatedAt: new Date(),
                    }
                  : {}),
              }
            : {}),
        },
      });
      return {
        installationId: id,
        appCode: binding.appCode,
        permission: updated.permission,
        lifecycle: registered
          ? 'REGISTERED'
          : row.hasRegistered
            ? 'LOGGED_OUT'
            : updated.onboardingState,
      };
    });
  }
}
