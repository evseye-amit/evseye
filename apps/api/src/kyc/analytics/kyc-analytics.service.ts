import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { Environment } from '../../config/environment.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AnalyticsFilter, KycAnalyticsQueryService } from './kyc-analytics-query.service.js';

const zero = () => new Prisma.Decimal(0);
const sum = (values: (Prisma.Decimal | null | undefined)[]) => values.reduce<Prisma.Decimal>((total, value) => total.plus(value ?? 0), zero());
const ratio = (numerator: number, denominator: number) => denominator ? new Prisma.Decimal(numerator).div(denominator).mul(100).toDecimalPlaces(2).toString() : null;
const money = (value: Prisma.Decimal) => value.toFixed(4);

@Injectable()
export class KycAnalyticsService {
  constructor(private readonly query: KycAnalyticsQueryService, private readonly prisma: PrismaService,
    private readonly config?: ConfigService<Environment, true>) {}

  async overview(q: AnalyticsFilter, internal: boolean) {
    const [verifications, attempts, consumption] = await Promise.all([
      this.query.verificationFacts(q), internal ? this.query.attemptFacts(q) : null, this.query.consumptionFacts(q),
    ]);
    const volume = verifications.rows.reduce((n, row) => n + row.count, 0);
    const success = verifications.rows.reduce((n, row) => n + row.success, 0);
    const fallback = verifications.rows.reduce((n, row) => n + row.fallback, 0);
    const usage = consumption.rows.reduce((n, row) => n + row.count, 0);
    const publicData = { businessVerifications: volume, successfulBusinessVerifications: success,
      businessVerificationSuccessRate: ratio(success, volume), fallbackVerifications: fallback,
      fallbackRate: ratio(fallback, volume), clientConsumption: usage,
      statusByType: verifications.rows.map(({ clientId, verificationType, count, success, technicalFailure, businessFailure }) =>
        ({ clientId: internal ? clientId : undefined, verificationType, count, success, technicalFailure, businessFailure })) };
    if (!internal || !attempts) return { metadata: verifications.metadata, ...publicData };
    return { metadata: verifications.metadata, ...publicData,
      knownSpendByCurrency: this.currencyTotals(attempts.rows, 'knownSpend'),
      unknownCostAttempts: attempts.rows.reduce((n, row) => n + row.unknownCostAttempts, 0),
      unknownBillabilityAttempts: attempts.rows.reduce((n, row) => n + row.unknownBillabilityAttempts, 0),
      directRevenueByCurrency: this.currencyTotals(consumption.rows, 'netRevenue'),
      technicalFailureAttempts: attempts.rows.reduce((n, row) => n + row.technicalFailure, 0),
      providerAttempts: attempts.rows.reduce((n, row) => n + row.requests, 0) };
  }

  private currencyTotals<T extends { currency: string | null }>(rows: T[], key: keyof T) {
    const grouped = new Map<string, Prisma.Decimal>();
    for (const row of rows) if (row.currency)
      grouped.set(row.currency, (grouped.get(row.currency) ?? zero()).plus(row[key] as Prisma.Decimal ?? 0));
    return [...grouped].map(([currency, amount]) => ({ currency, amount: money(amount) }));
  }

  async cost(q: AnalyticsFilter) {
    const [attempts, verifications] = await Promise.all([this.query.attemptFacts(q), this.query.verificationFacts(q)]);
    const successes = new Map<string, number>();
    for (const row of verifications.rows) {
      const key = `${row.clientId}|${row.verificationType}|${row.strategy}`;
      successes.set(key, (successes.get(key) ?? 0) + row.success);
    }
    const groups = new Map<string, typeof attempts.rows>();
    for (const row of attempts.rows) {
      const key = `${row.clientId}|${row.verificationType}|${row.strategy}|${row.currency ?? 'UNKNOWN'}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return { metadata: attempts.metadata, rows: [...groups.values()].map((rows) => {
      const first = rows[0];
      const successfulBusinessVerifications = successes.get(`${first.clientId}|${first.verificationType}|${first.strategy}`) ?? 0;
      const knownSpend = sum(rows.map((r) => r.knownSpend));
      const successCost = sum(rows.map((r) => r.successfulVerificationCost));
      const unknownCostAttempts = rows.reduce((n, r) => n + r.unknownCostAttempts, 0);
      const unknownBillabilityAttempts = rows.reduce((n, r) => n + r.unknownBillabilityAttempts, 0);
      return { clientId: first.clientId, verificationType: first.verificationType, strategy: first.strategy,
        currency: first.currency, knownSpend: money(knownSpend), unknownCostAttempts, unknownBillabilityAttempts,
        providerAttempts: rows.reduce((n, r) => n + r.requests, 0),
        billableKnownCostAttempts: rows.reduce((n, r) => n + r.billableKnownCostAttempts, 0),
        fallbackIncrementalCost: money(sum(rows.map((r) => r.fallbackCost))),
        parallelAttemptCost: money(sum(rows.map((r) => r.parallelCost))),
        hedgeIncrementalCost: money(sum(rows.map((r) => r.hedgeCost))),
        technicalFailureAttemptCost: money(sum(rows.map((r) => r.technicalFailureCost))),
        businessFailureAttemptCost: money(sum(rows.map((r) => r.businessFailureCost))),
        failedBusinessVerificationCost: money(sum(rows.map((r) => r.failedVerificationCost))),
        successfulBusinessVerifications,
        effectiveKnownCostPerSuccessfulBusinessVerification: successfulBusinessVerifications && first.currency
          ? money(successCost.div(successfulBusinessVerifications)) : null,
        effectiveCostComplete: unknownCostAttempts === 0 && unknownBillabilityAttempts === 0,
        providers: rows.map((r) => ({ providerId: r.providerId, provider: r.provider, knownSpend: money(r.knownSpend),
          unknownCostAttempts: r.unknownCostAttempts, unknownBillabilityAttempts: r.unknownBillabilityAttempts })) };
    }) };
  }

  async commercial(q: AnalyticsFilter) {
    const [consumption, costs, purchases] = await Promise.all([
      this.query.consumptionFacts(q), this.query.consumptionCostFacts(q), this.query.addOnPurchases(q)]);
    const rows = consumption.rows.map((row) => {
      const related = costs.rows.filter((a) => a.clientId === row.clientId && a.verificationType === row.verificationType && a.source === row.source);
      const unknown = related.reduce((n, a) => n + a.unknownCostAttempts + a.unknownBillabilityAttempts, 0);
      const costCurrencies = related.filter((a) => a.knownCost.gt(0)).map((a) => a.currency);
      const sameCurrency = costCurrencies.every((currency) => currency === row.currency);
      const knownCost = sum(related.map((a) => a.knownCost));
      const revenue = row.source === 'OVERAGE' ? row.netRevenue : null;
      return { clientId: row.clientId, verificationType: row.verificationType, source: row.source,
        currency: row.currency, consumption: row.count, quantity: row.quantity.toString(),
        baseSaleValue: row.source === 'OVERAGE' ? money(row.baseValue) : null,
        discountValue: row.source === 'OVERAGE' ? money(row.discountValue) : null,
        netDirectRevenue: revenue && row.currency ? money(revenue) : null,
        packageRevenueAllocation: row.source === 'INCLUDED' || row.source === 'ADD_ON' ? 'NOT_ALLOCATED' : 'NOT_APPLICABLE',
        knownVendorCostByCurrency: related.map((a) => ({ currency: a.currency, amount: money(a.knownCost) })),
        knownDirectGrossMargin: row.source === 'OVERAGE' && row.currency && sameCurrency && !unknown && !row.missingPrice
          ? money(row.netRevenue.minus(knownCost)) : null,
        missingPrice: row.missingPrice, unknownCostAttempts: unknown };
    });
    return { metadata: consumption.metadata, rows,
      addOnPurchases: purchases.rows.map((purchase) => ({ ...purchase,
        quantityPurchased: purchase.quantityPurchased.toString(), baseAmount: money(purchase.baseAmount),
        discountAmount: money(purchase.discountAmount), netAmount: money(purchase.netAmount) })),
      note: 'Add-on revenue is recognized at purchase and is not allocated to consumed verification rows. Margin is omitted when usage sources are mixed or costs are incomplete.' };
  }

  async providers(q: AnalyticsFilter) {
    const attempts = await this.query.attemptFacts(q);
    const groups = new Map<string, typeof attempts.rows>();
    for (const row of attempts.rows) {
      const key = `${row.clientId}|${row.providerId}|${row.verificationType}|${row.strategy}|${row.currency ?? 'UNKNOWN'}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return { metadata: attempts.metadata, rows: [...groups.values()].map((rows) => {
      const first = rows[0];
      const count = rows.reduce((n, r) => n + r.requests, 0);
      const technicalSuccess = rows.reduce((n, r) => n + r.technicalSuccess, 0);
      const technicalFailure = rows.reduce((n, r) => n + r.technicalFailure, 0);
      const completed = technicalSuccess + technicalFailure;
      const knownSpend = sum(rows.map((r) => r.knownSpend));
      const billableKnownCostAttempts = rows.reduce((n, r) => n + r.billableKnownCostAttempts, 0);
      const successfulVerificationsTouched = rows.reduce((n, r) => n + r.successfulVerificationsTouched, 0);
      const minimumSampleSize = this.config?.get('KYC_ANALYTICS_MIN_SAMPLE_SIZE') ?? 30;
      return { clientId: first.clientId, providerId: first.providerId, provider: first.provider, verificationType: first.verificationType,
        strategy: first.strategy,
        currency: first.currency, sampleSize: count, technicalSuccess, technicalFailure,
        businessFailure: rows.reduce((n, r) => n + r.businessFailure, 0),
        performanceStatus: completed < minimumSampleSize ? 'INSUFFICIENT_DATA' : 'OBSERVED', minimumSampleSize,
        technicalSuccessRate: completed >= minimumSampleSize ? ratio(technicalSuccess, completed) : null,
        timeoutRate: completed >= minimumSampleSize ? ratio(rows.reduce((n, r) => n + r.timeout, 0), completed) : null,
        rateLimitRate: completed >= minimumSampleSize ? ratio(rows.reduce((n, r) => n + r.rateLimited, 0), completed) : null,
        unavailable: rows.reduce((n, r) => n + r.unavailable, 0),
        authenticationFailure: rows.reduce((n, r) => n + r.authenticationFailure, 0),
        providerError: rows.reduce((n, r) => n + r.providerError, 0),
        malformedResponse: rows.reduce((n, r) => n + r.malformedResponse, 0),
        webhookFailure: rows.reduce((n, r) => n + r.webhookFailure, 0),
        missingLatency: rows.reduce((n, r) => n + r.missingLatency, 0),
        p50LatencyMs: first.p50LatencyMs, p95LatencyMs: first.p95LatencyMs, p99LatencyMs: first.p99LatencyMs,
        knownSpend: money(knownSpend), billableKnownCostAttempts,
        averageKnownCostPerBillableAttempt: billableKnownCostAttempts ? money(knownSpend.div(billableKnownCostAttempts)) : null,
        successfulVerificationsTouched,
        effectiveKnownCostPerSuccessfulVerificationTouched: successfulVerificationsTouched
          ? money(sum(rows.map((r) => r.successfulVerificationCost)).div(successfulVerificationsTouched)) : null,
        unknownCostAttempts: rows.reduce((n, r) => n + r.unknownCostAttempts, 0),
        unknownBillabilityAttempts: rows.reduce((n, r) => n + r.unknownBillabilityAttempts, 0) };
    }) };
  }

  async routing(q: AnalyticsFilter) {
    const [verifications, attempts, pairs] = await Promise.all([
      this.query.verificationFacts(q), this.query.attemptFacts(q), this.query.fallbackPairs(q)]);
    return { metadata: verifications.metadata,
      fallbackPairs: pairs.rows.map((row) => ({ ...row, knownIncrementalCost: money(row.knownIncrementalCost) })),
      rows: verifications.rows.map((row) => {
      const related = attempts.rows.filter((a) => a.clientId === row.clientId && a.verificationType === row.verificationType && a.strategy === row.strategy);
      const currencies = [...new Set(related.map((a) => a.currency))];
      return { ...row, fallbackRate: ratio(row.fallback, row.count), fallbackRecoveryRate: ratio(row.fallbackRecovered, row.fallback),
        providerAttempts: related.reduce((n, a) => n + a.requests, 0), hedgeSecondaryTriggers: related.reduce((n, a) => n + a.hedgeAttempts, 0),
        hedgeWins: related.reduce((n, a) => n + a.hedgeWins, 0),
        parallelAttempts: related.reduce((n, a) => n + a.parallelAttempts, 0),
        costByCurrency: currencies.map((currency) => ({ currency,
          knownSpend: money(sum(related.filter((a) => a.currency === currency).map((a) => a.knownSpend))),
          fallbackIncrementalCost: money(sum(related.filter((a) => a.currency === currency).map((a) => a.fallbackCost))),
          hedgeIncrementalCost: money(sum(related.filter((a) => a.currency === currency).map((a) => a.hedgeCost))) })) };
    }) };
  }

  async quality(q: AnalyticsFilter) {
    const [attempts, consumption] = await Promise.all([this.query.attemptFacts(q), this.query.consumptionFacts(q)]);
    const range = this.query.range(q);
    const [ledgerQuality] = await this.prisma.$queryRaw<Array<{ orphanKycLedgerEntries: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS "orphanKycLedgerEntries" FROM "FeatureUsageLedger" l
      LEFT JOIN "KycVerification" v ON v.id = l."referenceId"
      WHERE l."referenceType" = 'KYC_VERIFICATION' AND v.id IS NULL
        AND l."occurredAt" >= ${range.from} AND l."occurredAt" < ${range.to}
        ${q.clientId ? Prisma.sql`AND l."clientId" = ${q.clientId}` : Prisma.empty}`);
    const [currencyQuality] = await this.prisma.$queryRaw<Array<{ currencyMismatchAttempts: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS "currencyMismatchAttempts" FROM "KycVerificationAttempt" a
      JOIN "KycVerification" v ON v.id = a."verificationId"
      JOIN "FeatureUsageConsumption" c ON c."verificationId" = v.id
      WHERE v."requestedAt" >= ${range.from} AND v."requestedAt" < ${range.to}
        AND a.currency IS NOT NULL AND c.currency IS NOT NULL AND a.currency <> c.currency
        ${q.clientId ? Prisma.sql`AND v."clientId" = ${q.clientId}` : Prisma.empty}`);
    return { metadata: attempts.metadata,
      missingProviderCost: attempts.rows.reduce((n, a) => n + a.unknownCostAttempts, 0),
      unknownBillability: attempts.rows.reduce((n, a) => n + a.unknownBillabilityAttempts, 0),
      missingLatency: attempts.rows.reduce((n, a) => n + a.missingLatency, 0),
      missingOveragePrice: consumption.rows.reduce((n, c) => n + c.missingPrice, 0),
      orphanKycLedgerEntries: ledgerQuality.orphanKycLedgerEntries,
      currencyMismatchAttempts: currencyQuality.currencyMismatchAttempts };
  }
}
