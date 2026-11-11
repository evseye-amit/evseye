import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { allocationPaymentView } from '../../src/allocations/allocation-payment-view.js';
import { SubmitPaymentReferenceDto } from '../../src/allocations/dto/mobile-deployment.dto.js';

describe('allocation UPI payment resume contract', () => {
  it.each([
    ['PENDING', 'PAYMENT_PENDING', 'SUBMIT_PAYMENT_DETAILS', true],
    ['REJECTED', 'PAYMENT_PENDING', 'CORRECT_PAYMENT_DETAILS', true],
    ['SUBMITTED', 'PAYMENT_PENDING', 'AWAITING_VERIFICATION', false],
    ['PAID', 'PAYMENT_PAID', 'PAYMENT_COMPLETE', false],
    ['CANCELLED', 'PAYMENT_PENDING', 'CONTACT_SUPPORT', false],
    ['PENDING', 'ALLOCATED', 'CONTACT_SUPPORT', false],
  ])(
    'returns the next action for %s in %s',
    (status, workflow, nextAction, canSubmit) => {
      expect(
        allocationPaymentView(
          { status, providerReference: 'reference' },
          workflow,
        ),
      ).toMatchObject({
        status,
        providerReference: 'reference',
        source: 'DEPLOYMENT',
        nextAction,
        canSubmit,
        receiptOptional: true,
      });
    },
  );
  it('accepts references with optional completed receipt IDs and rejects malformed claims', async () => {
    const valid = { provider: 'UPI', providerReference: '123456789012' };
    expect(
      await validate(plainToInstance(SubmitPaymentReferenceDto, valid)),
    ).toHaveLength(0);
    expect(
      await validate(
        plainToInstance(SubmitPaymentReferenceDto, {
          ...valid,
          receiptPhotoIds: ['11111111-1111-4111-a111-111111111111'],
        }),
      ),
    ).toHaveLength(0);
    for (const invalid of [
      { provider: ' ' },
      { providerReference: ' ' },
      { receiptPhotoIds: null },
      { receiptPhotoIds: ['not-a-uuid'] },
      {
        receiptPhotoIds: Array(21).fill('11111111-1111-4111-a111-111111111111'),
      },
    ])
      expect(
        await validate(
          plainToInstance(SubmitPaymentReferenceDto, { ...valid, ...invalid }),
        ),
      ).not.toHaveLength(0);
  });
});
