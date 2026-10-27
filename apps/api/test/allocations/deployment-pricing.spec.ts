import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { Prisma, UserRole, type RateCardFee } from '@prisma/client';
import { ValidationPipe } from '@nestjs/common';
import {
  chooseFees,
  type VehicleFacts,
} from '../../src/rider-rate-cards/pricing-engine.js';
import { nextBillingBoundary } from '../../src/rider-billing/billing-cycle.js';
import { AskPaymentDto } from '../../src/allocations/dto/mobile-deployment.dto.js';
import { DeploymentCommercialController } from '../../src/allocations/deployment-commercial.controller.js';
import { ROLES_KEY } from '../../src/auth/decorators/roles.decorator.js';

const facts = {
  city: 'Gurugram',
  hubId: 'hub-1',
  ageMonths: 12,
} as VehicleFacts;
const fee = (code: string, overrides: Partial<RateCardFee> = {}) =>
  ({
    code,
    chargeType: 'ONBOARDING_FEE',
    isActive: true,
    amount: new Prisma.Decimal(100),
    priority: 0,
    ...overrides,
  }) as RateCardFee;

describe('versioned allocation fee selection', () => {
  it('selects hub/city/age-specific fees over generic and city-only fees', () => {
    const selected = chooseFees(
      [
        fee('DEFAULT'),
        fee('CITY', { city: 'gurugram' }),
        fee('HUB_AGE', {
          city: 'Gurugram',
          hubId: 'hub-1',
          minVehicleAgeMonths: 12,
          maxVehicleAgeMonths: 24,
        }),
      ],
      facts,
    );
    expect(selected.map((row) => row.code)).toEqual(['HUB_AGE']);
  });
  it('matches both age boundaries inclusively and falls back outside the band', () => {
    const rules = [
      fee('DEFAULT'),
      fee('AGE', { minVehicleAgeMonths: 12, maxVehicleAgeMonths: 24 }),
    ];
    expect(chooseFees(rules, { ...facts, ageMonths: 24 })[0].code).toBe('AGE');
    expect(chooseFees(rules, { ...facts, ageMonths: 25 })[0].code).toBe(
      'DEFAULT',
    );
    expect(chooseFees(rules, { ...facts, ageMonths: null })[0].code).toBe(
      'DEFAULT',
    );
  });
  it('rejects equally ranked matches and uses explicit priority to resolve them', () => {
    expect(() => chooseFees([fee('A'), fee('B')], facts)).toThrow(
      'Multiple equally ranked',
    );
    expect(
      chooseFees(
        [fee('A'), fee('B', { priority: 1, amount: new Prisma.Decimal(0) })],
        facts,
      )[0].amount.toFixed(2),
    ).toBe('0.00');
  });
  it('does not apply other-city or other-hub fees', () => {
    expect(
      chooseFees(
        [
          fee('DEFAULT'),
          fee('OTHER_CITY', { city: 'Delhi' }),
          fee('OTHER_HUB', { hubId: 'hub-2' }),
        ],
        facts,
      ).map((row) => row.code),
    ).toEqual(['DEFAULT']);
  });
  it('keeps calendar quarter boundaries rather than treating every quarter as 90 days', () => {
    expect(
      nextBillingBoundary(
        new Date('2026-01-31T04:30:00Z'),
        'QUARTERLY',
        'Asia/Kolkata',
      ).toISOString(),
    ).toBe('2026-04-30T04:30:00.000Z');
  });
  it('accepts an empty payment request and rejects caller-controlled prices', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    await expect(
      pipe.transform({}, { type: 'body', metatype: AskPaymentDto }),
    ).resolves.toEqual({});
    await expect(
      pipe.transform(
        { currency: 'INR', items: [{ amount: '1' }] },
        { type: 'body', metatype: AskPaymentDto },
      ),
    ).rejects.toThrow();
  });
  it('limits plan selection to fleet managers while allowing riders to view their scoped offer', () => {
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        DeploymentCommercialController.prototype.create,
      ),
    ).toEqual([UserRole.FLEET_MANAGER]);
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        DeploymentCommercialController.prototype.plans,
      ),
    ).toEqual([UserRole.FLEET_MANAGER]);
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        DeploymentCommercialController.prototype.get,
      ),
    ).toEqual([UserRole.FLEET_MANAGER, UserRole.RIDER]);
  });
});
