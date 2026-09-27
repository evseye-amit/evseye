import { randomUUID, createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PaymentMandateStatus,
  PaymentProviderEventStatus,
  Prisma,
} from '@prisma/client';
import type { Environment } from '../config/environment.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  PAYMENT_PROVIDER,
  type MandateResult,
  type PaymentProvider,
} from './payment-provider.interface.js';
import { ProviderRequestError } from './payment-provider.interface.js';
import { PaymentOrchestratorService } from './payment-orchestrator.service.js';

const openStatuses: PaymentMandateStatus[] = [
  'CREATING',
  'CREATED',
  'AUTHORIZATION_PENDING',
  'ACTIVE',
  'PAUSED',
  'UNKNOWN',
];
const money = (value: unknown, label: string) => {
  if (typeof value !== 'string' && typeof value !== 'number')
    throw new BadRequestException(
      `${label} must be configured as an INR amount.`,
    );
  const text = String(value);
  if (
    !/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(text) ||
    text.split('.')[0]!.length > 12 ||
    new Prisma.Decimal(text).lte(0)
  )
    throw new BadRequestException(`${label} must be a positive INR amount.`);
  return new Prisma.Decimal(text);
};

@Injectable()
export class MandateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Environment, true>,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly collections: PaymentOrchestratorService,
  ) {}

  private async context(
    clientId: string,
    userId: string,
    requestedMethod?: 'UPI_AUTOPAY' | 'ENACH',
  ) {
    const rider = await this.prisma.rider.findFirst({
      where: { clientId, userId, deletedAt: null },
      select: { id: true, name: true, mobile: true },
    });
    if (!rider)
      throw new NotFoundException(
        'Rider profile was not found for this client.',
      );
    const now = new Date();
    const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
    const subscription = await this.prisma.clientSubscription.findFirst({
      where: {
        clientId,
        status: 'ACTIVE',
        startDate: { lte: today },
        OR: [{ endDate: null }, { endDate: { gte: today } }],
        client: { status: 'ACTIVE', isActive: true },
      },
      orderBy: { startDate: 'desc' },
      include: {
        package: {
          include: {
            features: {
              where: {
                isIncluded: true,
                feature: { code: 'RIDER_AUTO_PAY', isActive: true },
              },
              include: { feature: true },
            },
          },
        },
      },
    });
    if (!subscription)
      throw new BadRequestException(
        'An active client package is required for AutoPay.',
      );
    const feature =
      subscription.package.isActive && subscription.package.features[0];
    if (!feature)
      throw new BadRequestException(
        'Rider AutoPay is not included in the active package.',
      );
    const raw = feature.configuration;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new BadRequestException(
        'Rider AutoPay package configuration is missing.',
      );
    const cfg = raw as Record<string, unknown>;
    const maxAmount = money(cfg.mandateMaxAmount, 'mandateMaxAmount');
    const validityDays = cfg.validityDays;
    if (
      typeof validityDays !== 'number' ||
      !Number.isInteger(validityDays) ||
      !Number.isSafeInteger(validityDays) ||
      validityDays <= 0
    )
      throw new BadRequestException(
        'Rider AutoPay validityDays must be a positive integer.',
      );
    if (
      !Array.isArray(cfg.paymentMethods) ||
      !cfg.paymentMethods.some(
        (method) => method === 'UPI_AUTOPAY' || method === 'ENACH',
      ) ||
      (requestedMethod && !cfg.paymentMethods.includes(requestedMethod))
    )
      throw new BadRequestException(
        `${requestedMethod} must be enabled in the package configuration.`,
      );
    const authorizationAmount =
      cfg.authorizationAmount == null
        ? undefined
        : money(cfg.authorizationAmount, 'authorizationAmount');
    if (authorizationAmount?.gt(maxAmount))
      throw new BadRequestException(
        'authorizationAmount cannot exceed mandateMaxAmount.',
      );
    if (
      !Number.isFinite(new Date(Date.now() + validityDays * 86400000).getTime())
    )
      throw new BadRequestException('Rider AutoPay validityDays is too large.');
    return {
      rider,
      subscription,
      maxAmount,
      validityDays,
      authorizationAmount,
      paymentMethods: cfg.paymentMethods.filter(
        (method): method is 'UPI_AUTOPAY' | 'ENACH' =>
          method === 'UPI_AUTOPAY' || method === 'ENACH',
      ),
    };
  }

  private view(mandate: {
    id: string;
    mandateNumber?: string | null;
    autoDebitEnabled?: boolean;
    status: PaymentMandateStatus;
    providerMandateId: string;
    authorizationSessionId: string | null;
    maxAmount: Prisma.Decimal;
    currency: string;
    expiresAt: Date;
    authorizedAt: Date | null;
    providerStatus: string | null;
    method?: string;
  }) {
    return {
      mandateId: mandate.id,
      mandateNumber: mandate.mandateNumber ?? null,
      autoDebitEnabled: mandate.autoDebitEnabled ?? true,
      providerMandateId: mandate.providerMandateId,
      status: mandate.status,
      method: mandate.method ?? 'UPI_AUTOPAY',
      providerStatus: mandate.providerStatus,
      subscriptionSessionId: mandate.authorizationSessionId,
      maxAmount: mandate.maxAmount.toFixed(2),
      currency: mandate.currency,
      expiresAt: mandate.expiresAt.toISOString(),
      authorizedAt: mandate.authorizedAt?.toISOString() ?? null,
      environment: this.config.getOrThrow('CASHFREE_ENVIRONMENT'),
    };
  }

  async current(clientId: string, userId: string) {
    const { rider, subscription, maxAmount, validityDays, paymentMethods } =
      await this.context(clientId, userId);
    const mandate = await this.prisma.paymentMandate.findFirst({
      where: { clientId, riderId: rider.id, status: { in: openStatuses } },
      orderBy: { createdAt: 'desc' },
    });
    return {
      packageCode: subscription.package.code,
      eligible: true,
      configuration: {
        maxAmount: maxAmount.toFixed(2),
        currency: 'INR',
        validityDays,
        methods: paymentMethods,
      },
      mandate: mandate ? this.view(mandate) : null,
    };
  }

  async upcoming(clientId: string, userId: string) {
    const rider = await this.prisma.rider.findFirst({ where: { clientId, userId, deletedAt: null }, select: { id: true } });
    if (!rider) throw new NotFoundException('Rider profile not found.');
    const items = await this.prisma.paymentTransaction.findMany({
      where: { clientId, riderId: rider.id, status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] } },
      include: { invoice: { select: { invoiceNumber: true, outstandingAmount: true } }, mandate: { select: { method: true } } },
      orderBy: { scheduledAt: 'asc' }, take: 20,
    });
    return items.map(item => ({ debitId: item.id, debitNumber: item.debitNumber, invoiceNumber: item.invoice.invoiceNumber,
      scheduledAmount: item.amount.toFixed(2), currentOutstanding: item.invoice.outstandingAmount.toFixed(2),
      amountMayChange: !item.amount.eq(item.invoice.outstandingAmount), scheduledFor: item.scheduledAt,
      mandateType: item.mandate.method, status: item.status,
      preDebitNotifiedAt: item.preDebitNotifiedAt }));
  }

  async debits(clientId: string, userId: string) {
    const rider = await this.prisma.rider.findFirst({ where: { clientId, userId, deletedAt: null }, select: { id: true } });
    if (!rider) throw new NotFoundException('Rider profile not found.');
    const items = await this.prisma.paymentTransaction.findMany({ where: { clientId, riderId: rider.id }, orderBy: { createdAt: 'desc' }, take: 100 });
    return items.map(item => ({ debitId: item.id, debitNumber: item.debitNumber, invoiceId: item.invoiceId, amount: item.amount.toFixed(2), currency: item.currency, status: item.status, scheduledFor: item.scheduledAt, failureCode: item.failureCode }));
  }

  async create(
    clientId: string,
    userId: string,
    requestKey: string,
    method: 'UPI_AUTOPAY' | 'ENACH' = 'UPI_AUTOPAY',
  ) {
    if (this.config.getOrThrow('PAYMENT_PROVIDER') === 'disabled')
      throw new ServiceUnavailableException('Payment provider is disabled.');
    if (!/^[A-Za-z0-9:_-]{8,120}$/.test(requestKey))
      throw new BadRequestException(
        'Idempotency-Key must contain 8–120 letters, digits, colon, underscore, or hyphen.',
      );
    const {
      rider,
      subscription,
      maxAmount,
      validityDays,
      authorizationAmount,
    } = await this.context(clientId, userId, method);
    const previous = await this.prisma.paymentMandate.findUnique({
      where: {
        clientId_riderId_requestKey: {
          clientId,
          riderId: rider.id,
          requestKey,
        },
      },
    });
    if (previous) {
      if (previous.status === 'CREATING' || previous.status === 'UNKNOWN') {
        try {
          return this.view(
            await this.applyProviderResult(
              previous.id,
              await this.provider.fetchMandate(previous.providerMandateId),
              'RECONCILE',
            ),
          );
        } catch {
          return this.view(previous);
        }
      }
      return this.view(previous);
    }
    const open = await this.prisma.paymentMandate.findFirst({
      where: { clientId, riderId: rider.id, status: { in: openStatuses }, expiresAt: { gt: new Date() } },
    });
    if (open)
      throw new ConflictException(
        'An AutoPay mandate already exists for this rider. Verify its status before creating another.',
      );
    const expiresAt = new Date(Date.now() + validityDays * 86400000);
    const providerMandateId = `EVSEYE_${randomUUID().replaceAll('-', '')}`;
    let mandate;
    try {
      mandate = await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Rider" WHERE id = ${rider.id} AND "clientId" = ${clientId} FOR UPDATE`;
        const competing = await tx.paymentMandate.findFirst({ where: { clientId, riderId: rider.id, status: { in: openStatuses }, expiresAt: { gt: new Date() } } });
        if (competing) throw new ConflictException('An AutoPay mandate already exists for this rider.');
        return tx.paymentMandate.create({
        data: {
          mandateNumber: `EVM-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 12).toUpperCase()}`,
          clientId,
          riderId: rider.id,
          requestKey,
          provider: this.config.getOrThrow('PAYMENT_PROVIDER').toUpperCase(),
          providerMandateId,
          status: 'CREATING',
          maxAmount,
          method,
          authorizationAmount,
          expiresAt,
          events: {
            create: { clientId, toStatus: 'CREATING', source: 'RIDER_REQUEST' },
          },
        },
      });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          'An AutoPay mandate is already being created. Retry with the same Idempotency-Key.',
        );
      throw error;
    }
    try {
      const result = await this.provider.createMandate({
        providerMandateId,
        idempotencyKey: mandate.id,
        customer: { name: rider.name, phone: rider.mobile },
        planName: `${subscription.package.name} Rider AutoPay`,
        mode: 'ON_DEMAND',
        maxAmount: maxAmount.toFixed(2),
        paymentMethods: [method],
        expiresAt: expiresAt.toISOString(),
        authorizationAmount: authorizationAmount?.toFixed(2),
      });
      const authoritative =
        result.status === 'ACTIVE'
          ? await this.provider.fetchMandate(providerMandateId)
          : result;
      return this.view(
        await this.applyProviderResult(mandate.id, authoritative, 'CREATE'),
      );
    } catch (error) {
      const knownRejection =
        error instanceof ProviderRequestError &&
        error.category === 'INVALID_REQUEST';
      // A timeout or provider failure may have succeeded remotely. Keep its identifier for reconciliation.
      await this.prisma.paymentMandate.update({
        where: { id: mandate.id },
        data: {
          status: knownRejection ? 'FAILED' : 'UNKNOWN',
          providerStatus: knownRejection
            ? 'CREATE_REJECTED'
            : 'CREATE_UNCERTAIN',
          events: {
            create: {
              clientId,
              fromStatus: 'CREATING',
              toStatus: knownRejection ? 'FAILED' : 'UNKNOWN',
              source: 'CREATE_ERROR',
            },
          },
        },
      });
      if (knownRejection)
        throw new BadRequestException(
          'Payment provider rejected the AutoPay configuration. Check the package mandate settings.',
        );
      throw new ServiceUnavailableException(
        'AutoPay creation is uncertain. Verify mandate status before retrying.',
      );
    }
  }

  private async applyProviderResult(
    mandateId: string,
    result: MandateResult,
    source: string,
    referenceId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.paymentMandate.findUniqueOrThrow({
        where: { id: mandateId },
      });
      if (result.providerMandateId !== current.providerMandateId)
        throw new BadRequestException(
          'Cashfree returned an unexpected subscription ID.',
        );
      const incoming = result.status as PaymentMandateStatus;
      const terminal = ['CANCELLED', 'FAILED', 'EXPIRED'];
      const status =
        terminal.includes(current.status) && incoming !== current.status
          ? current.status
          : current.status === 'ACTIVE' &&
              ['CREATED', 'AUTHORIZATION_PENDING', 'UNKNOWN'].includes(incoming)
            ? current.status
            : incoming === 'UNKNOWN' &&
                ['ACTIVE', 'CANCELLED', 'EXPIRED', 'FAILED'].includes(
                  current.status,
                )
              ? current.status
              : incoming;
      const changed = current.status !== status;
      const updated = await tx.paymentMandate.update({
        where: { id: mandateId },
        data: {
          status,
          providerStatus: result.rawStatus,
          ...(result.sessionId
            ? { authorizationSessionId: result.sessionId }
            : {}),
          ...(status === 'ACTIVE' && !current.authorizedAt
            ? { authorizedAt: new Date() }
            : {}),
          ...(status === 'CANCELLED' || status === 'EXPIRED' || status === 'FAILED'
            ? { autoDebitEnabled: false }
            : {}),
          ...(changed
            ? {
                events: {
                  create: {
                    clientId: current.clientId,
                    fromStatus: current.status,
                    toStatus: status,
                    source,
                    referenceId,
                  },
                },
              }
            : {}),
        },
      });
      const active =
        (status === 'ACTIVE' && updated.autoDebitEnabled !== false) ||
        Boolean(
          await tx.paymentMandate.findFirst({
            where: {
              clientId: current.clientId,
              riderId: current.riderId,
              status: 'ACTIVE',
              autoDebitEnabled: true,
              id: { not: current.id },
            },
            select: { id: true },
          }),
        );
      await tx.riderPaymentProfile.upsert({
        where: {
          clientId_riderId: {
            clientId: current.clientId,
            riderId: current.riderId,
          },
        },
        create: {
          clientId: current.clientId,
          riderId: current.riderId,
          autoPayEnabled: active,
        },
        update: { autoPayEnabled: active },
      });
      if (changed) await tx.auditLog.create({ data: {
        clientId: current.clientId, actorId: null, action: `AUTOPAY_MANDATE_${status}`,
        entityType: 'PaymentMandate', entityId: current.id,
        newData: { fromStatus: current.status, toStatus: status, source, referenceId },
      } });
      return updated;
    });
  }

  async verify(clientId: string, userId: string, mandateId: string) {
    const rider = await this.prisma.rider.findFirst({
      where: { clientId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!rider) throw new NotFoundException('Rider profile not found.');
    const mandate = await this.prisma.paymentMandate.findFirst({
      where: { id: mandateId, clientId, riderId: rider.id },
    });
    if (!mandate) throw new NotFoundException('AutoPay mandate not found.');
    const result = await this.provider.fetchMandate(mandate.providerMandateId);
    return this.view(
      await this.applyProviderResult(mandate.id, result, 'VERIFY'),
    );
  }

  async cancel(
    clientId: string,
    userId: string,
    mandateId: string,
    requestKey: string,
  ) {
    if (!/^[A-Za-z0-9:_-]{8,120}$/.test(requestKey))
      throw new BadRequestException('Idempotency-Key is required.');
    const rider = await this.prisma.rider.findFirst({
      where: { clientId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!rider) throw new NotFoundException('Rider profile not found.');
    const mandate = await this.prisma.paymentMandate.findFirst({
      where: { id: mandateId, clientId, riderId: rider.id },
    });
    if (!mandate) throw new NotFoundException('AutoPay mandate not found.');
    if (mandate.status === 'CANCELLED') return this.view(mandate);
    const result = await this.provider.cancelMandate(
      mandate.providerMandateId,
      requestKey,
    );
    return this.view(
      await this.applyProviderResult(mandate.id, result, 'RIDER_CANCEL'),
    );
  }

  async manage(clientId: string, userId: string, mandateId: string, requestKey: string, action: 'PAUSE' | 'RESUME') {
    if (!/^[A-Za-z0-9:_-]{8,120}$/.test(requestKey)) throw new BadRequestException('Idempotency-Key is required.');
    const rider = await this.prisma.rider.findFirst({ where: { clientId, userId, deletedAt: null }, select: { id: true } });
    if (!rider) throw new NotFoundException('Rider profile not found.');
    const mandate = await this.prisma.paymentMandate.findFirst({ where: { id: mandateId, clientId, riderId: rider.id } });
    if (!mandate) throw new NotFoundException('AutoPay mandate not found.');
    if (action === 'PAUSE' && mandate.status === 'PAUSED') return this.view(mandate);
    if (action === 'RESUME' && mandate.status === 'ACTIVE') return this.view(mandate);
    if (action === 'PAUSE' && mandate.status !== 'ACTIVE') throw new ConflictException('Only an active mandate can be paused.');
    if (action === 'RESUME' && mandate.status !== 'PAUSED') throw new ConflictException('Only a paused mandate can be resumed.');
    const result = action === 'PAUSE'
      ? await this.provider.pauseMandate(mandate.providerMandateId, requestKey)
      : await this.provider.resumeMandate(mandate.providerMandateId, requestKey);
    return this.view(await this.applyProviderResult(mandate.id, result, `RIDER_${action}`));
  }

  async setLocalEnabled(clientId: string, userId: string, enabled: boolean) {
    const rider = await this.prisma.rider.findFirst({ where: { clientId, userId, deletedAt: null }, select: { id: true } });
    if (!rider) throw new NotFoundException('Rider profile not found.');
    return this.prisma.$transaction(async tx => {
      const mandate = await tx.paymentMandate.findFirst({ where: { clientId, riderId: rider.id, status: 'ACTIVE' }, orderBy: { authorizedAt: 'desc' } });
      if (!mandate) throw new ConflictException('An active mandate is required.');
      const updated = await tx.paymentMandate.update({ where: { id: mandate.id }, data: { autoDebitEnabled: enabled } });
      await tx.riderPaymentProfile.upsert({ where: { clientId_riderId: { clientId, riderId: rider.id } }, create: { clientId, riderId: rider.id, autoPayEnabled: enabled }, update: { autoPayEnabled: enabled } });
      await tx.auditLog.create({ data: { clientId, actorId: userId, action: enabled ? 'AUTOPAY_LOCAL_ENABLED' : 'AUTOPAY_LOCAL_DISABLED', entityType: 'PaymentMandate', entityId: mandate.id } });
      return this.view(updated);
    });
  }

  async webhook(rawBody: Buffer, timestamp: string, signature: string) {
    if (this.config.getOrThrow('PAYMENT_PROVIDER') !== 'cashfree')
      throw new ServiceUnavailableException(
        'Cashfree webhooks are unavailable.',
      );
    const verified = this.provider.verifyWebhook(rawBody, timestamp, signature);
    const payload = verified.payload as Record<string, unknown>;
    const eventType = typeof payload.type === 'string' ? payload.type : '';
    const hash = createHash('sha256').update(rawBody).digest('hex');
    const eventKey = hash;
    const existing = await this.prisma.paymentProviderEvent.findUnique({
      where: { provider_eventKey: { provider: 'CASHFREE', eventKey } },
    });
    if (existing?.status === 'PROCESSED' || existing?.status === 'IGNORED')
      return { accepted: true, duplicate: true };
    const data =
      payload.data && typeof payload.data === 'object'
        ? (payload.data as Record<string, unknown>)
        : {};
    const details =
      data.subscription_details && typeof data.subscription_details === 'object'
        ? (data.subscription_details as Record<string, unknown>)
        : {};
    const providerMandateId =
      typeof details.subscription_id === 'string'
        ? details.subscription_id
        : typeof data.subscription_id === 'string'
          ? data.subscription_id
          : '';
    const mandate = providerMandateId
      ? await this.prisma.paymentMandate.findUnique({
          where: { providerMandateId },
        })
      : null;
    const supported =
      eventType === 'SUBSCRIPTION_STATUS_CHANGED' ||
      eventType === 'SUBSCRIPTION_AUTH_STATUS';
    const paymentEvent = [
      'SUBSCRIPTION_PAYMENT_NOTIFICATION_INITIATED',
      'SUBSCRIPTION_PAYMENT_SUCCESS',
      'SUBSCRIPTION_PAYMENT_FAILED',
      'SUBSCRIPTION_PAYMENT_CANCELLED',
    ].includes(eventType);
    if ((supported || paymentEvent) && !mandate)
      throw new NotFoundException('Cashfree subscription is not registered.');
    const providerPaymentId =
      typeof data.payment_id === 'string' ? data.payment_id : '';
    if (paymentEvent && !providerPaymentId)
      throw new BadRequestException(
        'Cashfree payment event has no payment ID.',
      );
    const event = await this.prisma.paymentProviderEvent.upsert({
      where: { provider_eventKey: { provider: 'CASHFREE', eventKey } },
      create: {
        provider: 'CASHFREE',
        eventKey,
        eventType: eventType || 'UNKNOWN',
        payloadHash: hash,
        status: 'RECEIVED',
        clientId: mandate?.clientId,
        mandateId: mandate?.id,
      },
      update: {},
    });
    if (!supported && !paymentEvent) {
      await this.prisma.paymentProviderEvent.update({
        where: { id: event.id },
        data: { status: 'IGNORED', processedAt: new Date() },
      });
      return { accepted: true, ignored: true };
    }
    try {
      let paymentTransactionId: string | null = null;
      if (eventType === 'SUBSCRIPTION_PAYMENT_NOTIFICATION_INITIATED') {
        const transaction = await this.prisma.paymentTransaction.findFirst({ where: { clientId: mandate!.clientId, mandateId: mandate!.id, providerPaymentId }, select: { id: true } });
        if (!transaction) throw new NotFoundException('Cashfree scheduled payment is not registered.');
        paymentTransactionId = transaction.id;
        await this.prisma.paymentTransaction.updateMany({ where: { id: transaction.id, clientId: mandate!.clientId, preDebitNotifiedAt: null }, data: { preDebitNotifiedAt: new Date() } });
      } else if (paymentEvent) {
        paymentTransactionId = await this.collections.processWebhook(mandate!.clientId, providerMandateId, providerPaymentId);
      }
      if (supported) {
        const result = await this.provider.fetchMandate(providerMandateId);
        await this.applyProviderResult(
          mandate!.id,
          result,
          'WEBHOOK',
          event.id,
        );
      }
      await this.prisma.paymentProviderEvent.update({
        where: { id: event.id },
        data: {
          status: 'PROCESSED',
          ...(paymentTransactionId ? { paymentTransactionId } : {}),
          processedAt: new Date(),
          failureReason: null,
        },
      });
      return { accepted: true };
    } catch {
      await this.prisma.paymentProviderEvent.update({
        where: { id: event.id },
        data: {
          status: 'FAILED' as PaymentProviderEventStatus,
          failureReason: 'PROVIDER_RECONCILIATION_FAILED',
        },
      });
      throw new ServiceUnavailableException(
        'Cashfree event reconciliation failed.',
      );
    }
  }
}
