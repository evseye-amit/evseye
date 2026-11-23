import { pushPreferenceEligibility } from './notification-preferences.js';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import {
  indianMobileVariants,
  normalizeIndianMobile,
} from '../common/phone.js';
import { PUSH_PROVIDER, type PushProvider } from './firebase-push.provider.js';
import {
  afterCursor,
  decodeCursor,
  digest,
  encodeCursor,
  hash,
  verifyInstallationCredential,
  notificationContent,
  parsePhones,
} from './notification.helpers.js';
import type {
  NotificationTestDevicesDto,
  TestNotificationDto,
  NotificationAudienceDto,
  NotificationPageDto,
  RegisterPushDeviceDto,
  SendNotificationDto,
} from './notification.dto.js';

import {
  targetPredicate,
  targetSnapshot,
  inboxEligibility,
  applicationRoles,
  applicationDeviceCodes,
} from './notification-targeting.js';

type Tx = Prisma.TransactionClient;
type Audience = NotificationAudienceDto & { userIds?: string[] };
const orderBy = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
@Injectable()
export class NotificationService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
    @Inject(PUSH_PROVIDER) private readonly provider: PushProvider,
  ) {}

  private pushConfigured(clientId: string) {
    return this.provider.clientConfigured
      ? this.provider.clientConfigured(clientId)
      : Promise.resolve(this.provider.configured);
  }

  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 30000,
        });
      } catch (cause) {
        if (
          cause instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2034', 'P2002'].includes(cause.code) &&
          attempt < 3
        )
          continue;
        if (
          cause instanceof Prisma.PrismaClientKnownRequestError &&
          cause.code === 'P2002'
        )
          throw new ConflictException(
            'Notification state changed concurrently. Please retry.',
          );
        throw cause;
      }
    }
  }
  private assertStaff(actor: AuthUser) {
    if (
      !actor.roles.some((role) =>
        ['CLIENT_ADMIN', 'FLEET_MANAGER'].includes(role),
      )
    )
      throw new ForbiddenException(
        'Only client admins and operations managers may send notifications.',
      );
  }
  async registerDevice(
    clientId: string,
    actor: AuthUser,
    input: RegisterPushDeviceDto,
  ) {
    if (
      (input.appCode === 'RIDER_APP' && !actor.roles.includes('RIDER')) ||
      (input.appCode === 'FLEET_MANAGER_APP' &&
        !actor.roles.includes('FLEET_MANAGER')) ||
      (input.appCode === 'TEAM_LEADER_APP' &&
        !actor.roles.includes('TEAM_LEAD'))
    )
      throw new ForbiddenException(
        'This app does not match your account role.',
      );
    if (!actor.sessionId)
      throw new UnauthorizedException(
        'An active login session is required for device registration.',
      );
    if (actor.clientId !== clientId)
      throw new ForbiddenException('Client mismatch.');
    const tokenHash = hash(input.token);
    return this.transaction(async (tx) => {
      const session = await tx.session.findFirst({
        where: {
          id: actor.sessionId,
          userId: actor.id,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          user: { clientId, isActive: true, deletedAt: null },
        },
      });
      if (!session) throw new UnauthorizedException('Session is unavailable.');
      const bindings = await tx.notificationAppBinding.findMany({
        where: {
          clientId,
          appCode: input.appCode,
          platform: input.platform,
          environment: this.config.get?.('PUSH_ENVIRONMENT') ?? 'development',
          ...(input.applicationId
            ? { applicationId: input.applicationId }
            : {}),
          isActive: true,
          firebaseConfiguration: { isActive: true },
        },
        take: 2,
      });
      if (bindings.length > 1)
        throw new BadRequestException(
          'applicationId is required to identify this app flavor.',
        );
      if (input.applicationId && !bindings.length)
        throw new BadRequestException(
          'No active Firebase binding matches this application.',
        );
      const bindingId = bindings[0]?.id ?? null;
      const installation = await tx.notificationInstallation.findUnique({
        where: { id: input.installationId },
      });
      if (installation) {
        if (installation.revokedAt)
          throw new UnauthorizedException('Installation is revoked.');
        verifyInstallationCredential(
          installation.credentialHash,
          input.installationCredential,
        );
        if (
          installation.clientId !== clientId ||
          installation.bindingId !== bindingId
        )
          throw new ForbiddenException('Installation application mismatch.');
      } else if (input.installationCredential)
        throw new UnauthorizedException('Installation not found.');
      const permission = input.permission ?? installation?.permission;
      const permitted =
        permission === undefined ||
        ['AUTHORIZED', 'PROVISIONAL'].includes(permission);

      await tx.pushDevice.updateMany({
        where: {
          tokenHash,
          isActive: true,
          NOT: { installationId: input.installationId, appCode: input.appCode },
        },
        data: {
          isActive: false,
          disabledReason: 'TOKEN_REGISTERED_TO_ANOTHER_INSTALLATION',
        },
      });
      const old = await tx.pushDevice.findUnique({
        where: {
          installationId_appCode: {
            installationId: input.installationId,
            appCode: input.appCode,
          },
        },
      });
      const changed =
        old &&
        (old.tokenHash !== tokenHash ||
          old.userId !== actor.id ||
          old.clientId !== clientId ||
          old.notificationAppBindingId !== bindingId ||
          old.platform !== input.platform ||
          old.isActive !== permitted);
      const data = {
        clientId,
        userId: actor.id,
        sessionId: actor.sessionId!,
        notificationAppBindingId: bindingId,
        platform: input.platform,
        token: input.token,
        tokenHash,
        isActive: permitted,
        topicReconciledAt: null,
        lastRegisteredAt: new Date(),
        disabledReason: permitted ? null : 'NOTIFICATION_PERMISSION_DENIED',
      };
      const row = old
        ? await tx.pushDevice.update({
            where: { id: old.id },
            data: {
              ...data,
              ...(changed ? { version: { increment: 1 } } : {}),
            },
          })
        : await tx.pushDevice.create({
            data: {
              ...data,
              installationId: input.installationId,
              appCode: input.appCode,
            },
          });
      if (installation)
        await tx.notificationInstallation.update({
          where: { id: installation.id },
          data: {
            hasRegistered: true,
            userId: actor.id,
            sessionId: actor.sessionId,
            permission: permission!,
            token: input.token,
            tokenHash,
            tokenUpdatedAt: new Date(),
            lastActiveAt: new Date(),
          },
        });
      return {
        installationId: row.installationId,
        appCode: row.appCode,
        platform: row.platform,
        registeredAt: row.lastRegisteredAt,
        ...(installation ? { lifecycle: 'REGISTERED', permission } : {}),
        pushBindingStatus: bindingId ? 'BOUND' : 'UNCONFIGURED',
      };
    });
  }
  async unregisterDevice(
    clientId: string,
    actor: AuthUser,
    installationId: string,
  ) {
    await this.transaction(async (tx) => {
      await tx.pushDevice.updateMany({
        where: {
          clientId,
          userId: actor.id,
          sessionId: actor.sessionId,
          installationId,
        },
        data: {
          isActive: false,
          disabledReason: 'UNREGISTERED',
          topicReconciledAt: null,
        },
      });
      await tx.notificationInstallation.updateMany({
        where: {
          id: installationId,
          clientId,
          userId: actor.id,
          sessionId: actor.sessionId,
        },
        data: { userId: null, sessionId: null },
      });
    });
    return { unregistered: true };
  }

  private audience(input: Audience) {
    const parsed = parsePhones(input.phoneNumbers);
    if (
      input.audience === 'PHONE_NUMBERS' &&
      !parsed.phones.length &&
      !parsed.invalid.length
    )
      throw new BadRequestException('Enter at least one phone number.');
    if (input.audience !== 'PHONE_NUMBERS' && input.phoneNumbers?.trim())
      throw new BadRequestException(
        'Phone numbers are only valid for the Phone Numbers audience.',
      );
    return {
      ...parsed,
      userIds:
        (input.userIds ?? input.selectedUserIds)
          ? [...new Set(input.userIds ?? input.selectedUserIds)].sort()
          : undefined,
    };
  }
  private predicate(
    clientId: string,
    input: Audience,
    parsed: ReturnType<NotificationService['audience']>,
  ): Prisma.Sql {
    const base = Prisma.sql`(${targetPredicate(input)}) AND u."clientId" = ${clientId} AND u."isActive" = true AND u."deletedAt" IS NULL AND u.role <> 'SUPER_ADMIN'`;
    const ids = parsed.userIds
      ? parsed.userIds.length
        ? Prisma.sql`AND u.id IN (${Prisma.join(parsed.userIds)})`
        : Prisma.sql`AND false`
      : Prisma.empty;
    const variants = parsed.phones.flatMap(indianMobileVariants);
    const phones =
      input.audience === 'PHONE_NUMBERS'
        ? variants.length
          ? Prisma.sql`AND u.mobile IN (${Prisma.join(variants)})`
          : Prisma.sql`AND false`
        : Prisma.empty;
    return Prisma.sql`${base} ${ids} ${phones}`;
  }

  async composerOptions(clientId: string, actor: AuthUser) {
    this.assertStaff(actor);
    const scoped = await this.scopeAudience(clientId, actor, {
      audience: 'ALL_USERS',
    });
    const fleetScope: Prisma.FleetWhereInput = {
      clientId,
      deletedAt: null,
      ...(scoped.hubIds
        ? {
            OR: [
              { currentHubId: { in: scoped.hubIds } },
              { currentHubId: null, homeHubId: { in: scoped.hubIds } },
            ],
          }
        : {}),
    };
    const [groups, hubs, vehicleTypes, oems] = await Promise.all([
      this.db.notificationParentGroup.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: {
          code: true,
          name: true,
          categories: {
            where: {
              isActive: true,
              applications: { some: { allowed: true } },
            },
            orderBy: { name: 'asc' },
            select: {
              code: true,
              name: true,
              applications: {
                where: { allowed: true },
                select: { application: true },
              },
            },
          },
        },
      }),
      this.db.hub.findMany({
        where: {
          clientId,
          deletedAt: null,
          ...(scoped.hubIds ? { id: { in: scoped.hubIds } } : {}),
        },
        select: { id: true, name: true, city: true },
        orderBy: { name: 'asc' },
      }),
      this.db.vehicleType.findMany({
        where: { fleets: { some: fleetScope } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.db.oem.findMany({
        where: { fleets: { some: fleetScope } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      groups: groups.filter((g) => g.categories.length),
      hubs,
      vehicleTypes,
      oems,
      hubScoped: !actor.roles.includes('CLIENT_ADMIN'),
    };
  }

  private async audiencePreview(db: Tx, clientId: string, input: Audience) {
    const parsed = this.audience(input);
    const where = this.predicate(clientId, input, parsed);
    const [counts] = await db.$queryRaw<
      Array<{ users: bigint; devices: bigint; pushUsers: bigint }>
    >(Prisma.sql`
      SELECT (SELECT count(*) FROM "User" u WHERE ${where}) AS users,
        count(d.id) AS devices, count(DISTINCT d."userId") AS "pushUsers"
      FROM "PushDevice" d JOIN "User" u ON u.id = d."userId" JOIN "Session" s ON s.id = d."sessionId"
      WHERE ${where} AND d."clientId" = ${clientId} AND d."isActive" AND s."revokedAt" IS NULL AND s."expiresAt" > now() AND s."userId"=u.id ${input.application ? Prisma.sql`AND d."appCode"=${applicationDeviceCodes[input.application] ?? 'UNSUPPORTED'}` : Prisma.empty}`);
    let unmatched: string[] = [];
    if (input.audience === 'PHONE_NUMBERS' && parsed.phones.length) {
      const matches = await db.$queryRaw<Array<{ mobile: string }>>(
        Prisma.sql`SELECT u.mobile FROM "User" u WHERE ${where}`,
      );
      const matched = new Set(
        matches.map((entry) => normalizeIndianMobile(entry.mobile)),
      );
      unmatched = parsed.phones.filter((phone) => !matched.has(phone));
    }
    return {
      users: Number(counts!.users),
      devices: Number(counts!.devices),
      usersWithoutDevices: Number(counts!.users) - Number(counts!.pushUsers),
      invalidPhoneNumbers: parsed.invalid,
      duplicatePhoneNumbers: parsed.duplicates,
      unmatchedPhoneNumbers: unmatched,
      normalizedPhoneNumbers: parsed.phones,
      pushConfigured: await this.pushConfigured(clientId),
    };
  }
  async preview(
    clientId: string,
    actor: AuthUser,
    input: NotificationAudienceDto,
  ) {
    this.assertStaff(actor);
    return this.audiencePreview(
      this.db,
      clientId,
      await this.scopeAudience(clientId, actor, input),
    );
  }
  async send(
    clientId: string,
    actor: AuthUser,
    input: SendNotificationDto,
    requestKey: string,
  ) {
    this.assertStaff(actor);
    return this.transaction(async (tx) =>
      this.enqueueInTransaction(
        tx,
        clientId,
        actor.id,
        { ...input, ...(await this.scopeAudience(clientId, actor, input, tx)) },
        requestKey,
        'MANUAL',
      ),
    );
  }

  private async scopeAudience(
    clientId: string,
    actor: AuthUser,
    input: NotificationAudienceDto,
    db: Tx = this.db,
  ) {
    if (actor.clientId !== clientId)
      throw new ForbiddenException('Client mismatch.');
    if (input.cities?.some((c) => !c.trim()))
      throw new BadRequestException('City filters cannot be blank.');
    if (input.selectedUserIds && !input.selectedUserIds.length)
      throw new BadRequestException('Select at least one user.');
    if (actor.roles.includes('CLIENT_ADMIN')) return input;
    const assignments = await db.userHub.findMany({
      where: { clientId, userId: actor.id, hub: { clientId, deletedAt: null } },
      select: { hubId: true },
    });
    const allowed = assignments.map((a) => a.hubId);
    if (!allowed.length)
      throw new ForbiddenException(
        'No assigned hubs are available for notification targeting.',
      );
    if (input.hubIds?.some((id) => !allowed.includes(id)))
      throw new ForbiddenException(
        'Notification audience exceeds your assigned hubs.',
      );
    return { ...input, hubIds: input.hubIds?.length ? input.hubIds : allowed };
  }

  private assertTestAdmin(clientId: string, actor: AuthUser) {
    if (actor.clientId !== clientId || !actor.roles.includes('CLIENT_ADMIN'))
      throw new ForbiddenException(
        'Only client administrators can send test notifications.',
      );
  }
  private testDeviceWhere(
    clientId: string,
    application: string,
  ): Prisma.PushDeviceWhereInput {
    const appCode = applicationDeviceCodes[application];
    if (!appCode || application === 'ADMIN')
      throw new BadRequestException('Choose a mobile application.');
    return {
      clientId,
      appCode,
      isActive: true,
      session: { revokedAt: null, expiresAt: { gt: new Date() } },
      user: {
        clientId,
        isActive: true,
        deletedAt: null,
        role: { in: applicationRoles[application] as UserRole[] },
        client: { isActive: true, status: { notIn: ['DRAFT', 'SUSPENDED'] } },
      },
    };
  }
  async testDevices(
    clientId: string,
    actor: AuthUser,
    input: NotificationTestDevicesDto,
  ) {
    this.assertTestAdmin(clientId, actor);
    const phone = normalizeIndianMobile(input.phone);
    if (!/^\+91[6-9]\d{9}$/.test(phone))
      throw new BadRequestException('Enter a valid Indian mobile number.');
    const where = this.testDeviceWhere(clientId, input.application);
    return this.db.pushDevice.findMany({
      where: {
        ...where,
        user: {
          ...(where.user as Prisma.UserWhereInput),
          mobile: { in: indianMobileVariants(phone) },
        },
      },
      orderBy: [{ lastRegisteredAt: 'desc' }, { id: 'asc' }],
      take: 50,
      select: {
        id: true,
        platform: true,
        appCode: true,
        lastRegisteredAt: true,
        user: { select: { name: true } },
      },
    });
  }
  async testSend(
    clientId: string,
    actor: AuthUser,
    input: TestNotificationDto,
    key: string,
  ) {
    this.assertTestAdmin(clientId, actor);
    if (!/^[A-Za-z0-9:_.-]{8,150}$/.test(key ?? ''))
      throw new BadRequestException(
        'A stable Idempotency-Key of 8–150 characters is required.',
      );
    return this.transaction(async (tx) => {
      const existing = await tx.notificationMessage.findUnique({
        where: { clientId_requestKey: { clientId, requestKey: key } },
      });
      if (
        existing &&
        (existing.source !== 'TEST' || existing.senderId !== actor.id)
      )
        throw new ConflictException(
          'Idempotency-Key was already used for a different notification.',
        );
      const previous = existing
        ? await tx.userNotification.findFirst({
            where: { messageId: existing.id, clientId },
            select: { userId: true },
          })
        : null;
      const device = existing
        ? null
        : await tx.pushDevice.findFirst({
            where: {
              ...this.testDeviceWhere(clientId, input.application),
              id: input.deviceId,
            },
            select: {
              id: true,
              userId: true,
              session: { select: { userId: true } },
              version: true,
            },
          });
      if (!existing && (!device || device.session.userId !== device.userId))
        throw new NotFoundException('Active test device not found.');
      const userId = previous?.userId ?? device?.userId;
      if (!userId)
        throw new ConflictException('Test recipient is unavailable.');
      const message = await this.enqueueInTransaction(
        tx,
        clientId,
        actor.id,
        {
          audience: 'ALL_USERS',
          userIds: [userId],
          application: input.application,
          categoryCode: input.categoryCode,
          title: '[Test] ' + input.title,
          body: input.body,
          data: { testNotification: 'true', testDeviceId: input.deviceId },
        },
        key,
        'TEST',
      );
      if (!existing) {
        const recipient = await tx.userNotification.findFirstOrThrow({
          where: { messageId: message.id, clientId, userId },
          select: { id: true },
        });
        await tx.pushDelivery.create({
          data: {
            messageId: message.id,
            userNotificationId: recipient.id,
            deviceId: device!.id,
            deviceVersion: device!.version,
          },
        });
        // Prevent normal expansion from adding the user's other devices.
        await tx.userNotification.update({
          where: { id: recipient.id },
          data: { expandedAt: new Date(), noActiveDevice: false },
        });
      }
      return message;
    });
  }

  /** Use a stable business event key; call inside the business transaction when possible. */
  async enqueueForUsers(
    tx: Tx,
    clientId: string,
    userIds: string[],
    content: {
      title: string;
      body: string;
      data?: Record<string, string>;
      categoryCode?: string;
      application?: SendNotificationDto['application'];
    },
    eventKey: string,
    source = 'SYSTEM',
  ) {
    if (!userIds.length || userIds.length > 10000)
      throw new BadRequestException(
        'Select between one and 10,000 users per business event.',
      );
    return this.enqueueInTransaction(
      tx,
      clientId,
      null,
      { ...content, audience: 'ALL_USERS', userIds },
      eventKey,
      source,
    );
  }
  async sendToUsers(
    clientId: string,
    userIds: string[],
    content: {
      title: string;
      body: string;
      data?: Record<string, string>;
      categoryCode?: string;
      application?: SendNotificationDto['application'];
    },
    eventKey: string,
    source = 'SYSTEM',
  ) {
    return this.transaction((tx) =>
      this.enqueueForUsers(tx, clientId, userIds, content, eventKey, source),
    );
  }
  private async enqueueInTransaction(
    tx: Tx,
    clientId: string,
    senderId: string | null,
    input: SendNotificationDto & { userIds?: string[] },
    requestKey: string,
    source: string,
  ) {
    if (!/^[A-Za-z0-9:_.-]{8,150}$/.test(requestKey ?? ''))
      throw new BadRequestException(
        'A stable Idempotency-Key of 8–150 characters is required.',
      );
    if (!/^[A-Z][A-Z0-9_]{0,49}$/.test(source))
      throw new BadRequestException('Invalid notification source.');
    const content = notificationContent(input.title, input.body, input.data);
    const parsed = this.audience(input);
    if (parsed.invalid.length)
      throw new BadRequestException({
        code: 'INVALID_NOTIFICATION_PHONES',
        message: 'Correct the invalid phone numbers before sending.',
        invalidPhoneNumbers: parsed.invalid,
      });
    const scheduledFor = input.scheduledFor
      ? new Date(input.scheduledFor)
      : null;
    if (scheduledFor && !Number.isFinite(scheduledFor.getTime()))
      throw new BadRequestException('Invalid scheduled time.');
    const requestDigest = digest({
      ...content,
      audience: parsed.userIds ? 'USER_IDS' : input.audience,
      phones: parsed.phones,
      userIds: parsed.userIds,
      source,
      senderId,
      ...(scheduledFor ? { scheduledFor: scheduledFor.toISOString() } : {}),
      ...(input.application ||
      input.roles?.length ||
      input.hubIds?.length ||
      input.cities?.length ||
      input.fleetIds?.length ||
      input.vehicleTypeIds?.length ||
      input.oemIds?.length ||
      input.categoryCode ||
      input.visibilityPolicy ||
      input.visibilityExpiresAt
        ? {
            targeting: targetSnapshot(input),
            categoryCode: input.categoryCode ?? null,
            visibilityPolicy: input.visibilityPolicy ?? 'OPERATIONAL',
            visibilityExpiresAt: input.visibilityExpiresAt ?? null,
          }
        : {}),
    });
    const old = await tx.notificationMessage.findUnique({
      where: { clientId_requestKey: { clientId, requestKey } },
    });
    if (old) {
      if (old.requestDigest !== requestDigest)
        throw new ConflictException(
          'Idempotency-Key was already used for a different notification.',
        );
      return old;
    }
    if (
      scheduledFor &&
      (source !== 'MANUAL' ||
        scheduledFor.getTime() < Date.now() + 60000 ||
        scheduledFor.getTime() > Date.now() + 90 * 86400000)
    )
      throw new BadRequestException(
        'Schedule manual notifications between one minute and 90 days ahead.',
      );
    if (
      scheduledFor &&
      input.visibilityExpiresAt &&
      new Date(input.visibilityExpiresAt) <= scheduledFor
    )
      throw new BadRequestException(
        'Visibility expiry must be after the scheduled time.',
      );
    const snapshot = targetSnapshot(input);
    const operational =
      source === 'MANUAL' ||
      Boolean(
        snapshot.targetHubIds.length ||
        snapshot.targetCities.length ||
        snapshot.targetFleetIds.length ||
        snapshot.targetVehicleTypeIds.length ||
        snapshot.targetOemIds.length,
      );
    if (
      input.visibilityPolicy === 'GENERAL' &&
      operational &&
      (snapshot.targetRoles.length ||
        snapshot.targetHubIds.length ||
        snapshot.targetCities.length ||
        snapshot.targetFleetIds.length ||
        snapshot.targetVehicleTypeIds.length ||
        snapshot.targetOemIds.length)
    )
      throw new BadRequestException(
        'Scoped messages require OPERATIONAL visibility.',
      );
    if (
      input.visibilityExpiresAt &&
      new Date(input.visibilityExpiresAt) <= new Date()
    )
      throw new BadRequestException('Visibility expiry must be in the future.');
    if (input.categoryCode) {
      if (!input.application)
        throw new BadRequestException(
          'Category messages require an application.',
        );
      const category = await tx.notificationCategory.findFirst({
        where: {
          code: input.categoryCode,
          isActive: true,
          parent: { isActive: true },
          applications: {
            some: { application: input.application, allowed: true },
          },
        },
      });
      if (!category)
        throw new BadRequestException(
          'Category is unavailable for this application.',
        );
    }
    const preview = await this.audiencePreview(tx, clientId, input);
    if (preview.unmatchedPhoneNumbers.length)
      throw new BadRequestException(
        'Some phone numbers do not match an active user in this client. Remove or correct them before sending.',
      );
    if (parsed.userIds && preview.users !== parsed.userIds.length)
      throw new BadRequestException(
        'Every recipient must be an active user in this client.',
      );
    if (!preview.users)
      throw new BadRequestException('No active users match this audience.');
    const id = randomUUID();
    const now = new Date();
    const row = await tx.notificationMessage.create({
      data: {
        id,
        clientId,
        senderId,
        scheduledFor,
        status: scheduledFor ? 'SCHEDULED' : 'QUEUED',
        ...snapshot,
        categoryCode: input.categoryCode ?? null,
        visibilityPolicy:
          input.visibilityPolicy ?? (operational ? 'OPERATIONAL' : 'PERSONAL'),
        visibilityExpiresAt: input.visibilityExpiresAt
          ? new Date(input.visibilityExpiresAt)
          : null,
        ...content,
        audience: parsed.userIds ? 'USER_IDS' : input.audience,
        audiencePhones: parsed.phones,
        requestKey,
        requestDigest,
        source,
        totalUsers: preview.users,
        pushExpiresAt: new Date(
          (scheduledFor ?? now).getTime() +
            this.config.getOrThrow<number>('PUSH_TTL_SECONDS') * 1000,
        ),
        createdAt: now,
      },
    });
    // Resolve the audience once at send time; device delivery is processed asynchronously.
    await tx.$executeRaw(Prisma.sql`INSERT INTO "UserNotification" (id, "clientId", "userId", "messageId", "createdAt", "noActiveDevice")
      SELECT gen_random_uuid()::text, ${clientId}, u.id, ${id}, ${scheduledFor ?? now}, false FROM "User" u WHERE ${this.predicate(clientId, input, parsed)}
      ON CONFLICT ("messageId", "userId") DO NOTHING`);
    await tx.auditLog.create({
      data: {
        clientId,
        actorId: senderId,
        action: scheduledFor ? 'NOTIFICATION_SCHEDULED' : 'NOTIFICATION_QUEUED',
        entityType: 'NotificationMessage',
        entityId: row.id,
        newData: {
          audience: row.audience,
          totalUsers: row.totalUsers,
          source,
          ...(scheduledFor ? { scheduledFor: scheduledFor.toISOString() } : {}),
        },
      },
    });
    return row;
  }

  private async inboxScope(
    clientId: string,
    userId: string,
    application?: string,
  ) {
    if (application) {
      const user = await this.db.user.findFirst({
        where: { id: userId, clientId, isActive: true, deletedAt: null },
        select: { role: true },
      });
      if (!user || !applicationRoles[application]?.includes(user.role))
        throw new ForbiddenException(
          'This application does not match your account role.',
        );
    }
    return inboxEligibility(clientId, userId, application);
  }
  async inbox(clientId: string, userId: string, query: NotificationPageDto) {
    const eligibility = await this.inboxScope(
      clientId,
      userId,
      query.application,
    );
    const cursor = decodeCursor(query.cursor);
    const rows = await this.db.$queryRaw<
      Array<{
        id: string;
        messageId: string;
        title: string;
        body: string;
        data: unknown;
        source: string;
        categoryCode: string | null;
        application: string | null;
        createdAt: Date;
        readAt: Date | null;
      }>
    >(Prisma.sql`
      SELECT n.id,n."messageId",n."createdAt",n."readAt",m.title,m.body,m.data,m.source,m."categoryCode",m.application
      FROM "UserNotification" n JOIN "NotificationMessage" m ON m.id=n."messageId" JOIN "User" u ON u.id=n."userId"
      WHERE ${eligibility} ${cursor ? Prisma.sql`AND (n."createdAt",n.id) < (${new Date(cursor.at)},${cursor.id})` : Prisma.empty}
      ORDER BY n."createdAt" DESC,n.id DESC LIMIT ${query.limit + 1}`);
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor(last.createdAt, last.id)
          : null,
    };
  }
  async unread(clientId: string, userId: string, application?: string) {
    const eligibility = await this.inboxScope(clientId, userId, application);
    const [row] = await this.db.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`SELECT count(*) AS count FROM "UserNotification" n JOIN "NotificationMessage" m ON m.id=n."messageId" JOIN "User" u ON u.id=n."userId" WHERE ${eligibility} AND n."readAt" IS NULL`,
    );
    return { count: Number(row!.count) };
  }
  async read(
    clientId: string,
    userId: string,
    id: string,
    application?: string,
  ) {
    const eligibility = await this.inboxScope(clientId, userId, application);
    const count = await this.db.$executeRaw(
      Prisma.sql`UPDATE "UserNotification" n SET "readAt"=COALESCE(n."readAt",now()) FROM "NotificationMessage" m,"User" u WHERE m.id=n."messageId" AND u.id=n."userId" AND n.id=${id} AND ${eligibility}`,
    );
    if (!count) throw new NotFoundException('Notification not found.');
    return { read: true };
  }
  async readAll(
    clientId: string,
    userId: string,
    throughId?: string,
    application?: string,
  ) {
    const eligibility = await this.inboxScope(clientId, userId, application);
    const now = new Date();
    const anchors = throughId
      ? await this.db.$queryRaw<Array<{ id: string; createdAt: Date }>>(
          Prisma.sql`SELECT n.id,n."createdAt" FROM "UserNotification" n JOIN "NotificationMessage" m ON m.id=n."messageId" JOIN "User" u ON u.id=n."userId" WHERE n.id=${throughId} AND ${eligibility}`,
        )
      : [];
    const anchor = anchors[0];
    if (throughId && !anchor)
      throw new NotFoundException('Notification not found.');
    const bound = anchor
      ? Prisma.sql`(n."createdAt",n.id)<=(${anchor.createdAt},${anchor.id})`
      : Prisma.sql`n."createdAt"<=${now}`;
    const updated = await this.db.$executeRaw(
      Prisma.sql`UPDATE "UserNotification" n SET "readAt"=${now} FROM "NotificationMessage" m,"User" u WHERE m.id=n."messageId" AND u.id=n."userId" AND ${eligibility} AND n."readAt" IS NULL AND ${bound}`,
    );
    return { updated };
  }
  async eligibleForDeliveries(clientId: string, notificationIds: string[]) {
    if (!notificationIds.length) return new Set<string>();
    const rows = await this.db.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT n.id FROM "UserNotification" n JOIN "NotificationMessage" m ON m.id=n."messageId" JOIN "User" u ON u.id=n."userId" WHERE n.id IN (${Prisma.join([...new Set(notificationIds)])}) AND ${inboxEligibility(clientId)} AND ${pushPreferenceEligibility()}`,
    );
    return new Set(rows.map((r) => r.id));
  }
  async withdraw(clientId: string, actor: AuthUser, id: string) {
    this.assertStaff(actor);
    if (actor.clientId !== clientId)
      throw new ForbiddenException('Client mismatch.');
    return this.transaction(async (tx) => {
      const where = {
        clientId,
        id,
        ...(actor.roles.includes('CLIENT_ADMIN') ? {} : { senderId: actor.id }),
      };
      const row = await tx.notificationMessage.findFirst({ where });
      if (!row) throw new NotFoundException('Notification not found.');
      const changed = await tx.notificationMessage.updateMany({
        where: { ...where, withdrawnAt: null },
        data: { withdrawnAt: new Date() },
      });
      if (changed.count)
        await tx.auditLog.create({
          data: {
            clientId,
            actorId: actor.id,
            action: 'NOTIFICATION_WITHDRAWN',
            entityType: 'NotificationMessage',
            entityId: id,
          },
        });
      return { withdrawn: true };
    });
  }
  async history(clientId: string, actor: AuthUser, query: NotificationPageDto) {
    this.assertStaff(actor);
    const rows = await this.db.notificationMessage.findMany({
      where: {
        clientId,
        ...(actor.roles.includes('CLIENT_ADMIN') ? {} : { senderId: actor.id }),
        ...afterCursor(decodeCursor(query.cursor)),
      },
      orderBy,
      take: query.limit + 1,
      include: {
        sender: { select: { name: true, role: true } },
        category: { select: { name: true } },
      },
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const items = await Promise.all(
      page.map(async (row) => ({
        ...row,
        ...(await this.stats(row.id)),
        pushConfigured: await this.pushConfigured(clientId),
      })),
    );
    return {
      items,
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor(last.createdAt, last.id)
          : null,
    };
  }
  async details(clientId: string, actor: AuthUser, id: string) {
    this.assertStaff(actor);
    const message = await this.db.notificationMessage.findFirst({
      where: {
        clientId,
        id,
        ...(actor.roles.includes('CLIENT_ADMIN') ? {} : { senderId: actor.id }),
      },
      include: {
        sender: { select: { name: true, role: true } },
        category: { select: { name: true } },
      },
    });
    if (!message)
      throw new NotFoundException('Notification broadcast not found.');
    const failures = await this.db.pushDelivery.findMany({
      where: { messageId: id, status: { in: ['FAILED', 'RETRY', 'SKIPPED'] } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        status: true,
        attempts: true,
        errorCode: true,
        nextAttemptAt: true,
        userNotification: {
          select: { user: { select: { name: true, mobile: true } } },
        },
      },
    });
    return {
      ...message,
      ...(await this.stats(id)),
      failures,
      pushConfigured: await this.pushConfigured(clientId),
    };
  }
  async stats(messageId: string) {
    const [groups, pendingExpansion, noDevices, readUsers, acceptedUsers] =
      await Promise.all([
        this.db.pushDelivery.groupBy({
          by: ['status'],
          where: { messageId },
          _count: { _all: true },
        }),
        this.db.userNotification.count({
          where: { messageId, expandedAt: null },
        }),
        this.db.userNotification.count({
          where: { messageId, noActiveDevice: true },
        }),
        this.db.userNotification.count({
          where: { messageId, readAt: { not: null } },
        }),
        this.db.userNotification.count({
          where: { messageId, deliveries: { some: { status: 'ACCEPTED' } } },
        }),
      ]);
    return {
      deliveryCounts: Object.fromEntries(
        groups.map((group) => [group.status, group._count._all]),
      ),
      pendingExpansion,
      usersWithoutDevices: noDevices,
      readUsers,
      usersAcceptedByFirebase: acceptedUsers,
    };
  }
}
