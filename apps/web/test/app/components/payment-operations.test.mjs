import test from 'node:test';
import assert from 'node:assert/strict';
import { operationAction, readRefundDraft } from '../../../src/app/components/payment-operations-model.ts';

test('uncertain payments only offer provider recovery, not replacement charges', () => {
  for (const source of ['CHECKOUT', 'AUTOPAY', 'DEPLOYMENT']) {
    assert.equal(operationAction({ source, riderId: 'r', state: 'UNKNOWN' }), 'RECOVER');
    assert.equal(operationAction({ source, riderId: 'r', state: 'MATCHED' }), null);
  }
  assert.equal(operationAction({ source: 'WEBHOOK', riderId: null, state: 'MANUAL_REVIEW_REQUIRED' }), null);
  assert.equal(operationAction({ source: 'REFUND', riderId: 'r', state: 'MANUAL_REVIEW_REQUIRED' }), 'VERIFY_REFUND');
  assert.equal(operationAction({ source: 'REFUND', riderId: 'r', state: 'FAILED' }), null);
});

test('refund recovery preserves the exact financial request and rejects another payment or rider', () => {
  const draft = { key: 'refund-key-123', paymentId: 'p', riderId: 'r', amount: '500.00', reason: 'Duplicate payment', treatment: 'UNALLOCATED_RETURN' };
  assert.deepEqual(readRefundDraft(JSON.stringify(draft), 'p', 'r'), draft);
  assert.throws(() => readRefundDraft(JSON.stringify(draft), 'other-payment', 'r'));
  assert.throws(() => readRefundDraft(JSON.stringify(draft), 'p', 'other-rider'));
  assert.throws(() => readRefundDraft(JSON.stringify({ ...draft, amount: '-500' }), 'p', 'r'));
  assert.throws(() => readRefundDraft('{', 'p', 'r'));
  assert.equal(readRefundDraft(null, 'p', 'r'), null);
});

test('operation filters combine gateway, state and nested gateway reference', async () => {
  const { filterOperations } = await import('../../../src/app/components/payment-operations-model.ts');
  const rows = [
    { id: 'a', source: 'DEPLOYMENT', riderId: 'r1', provider: 'RAZORPAY', state: 'REVIEW', captures: [{ providerPaymentId: 'pay_ABC' }] },
    { id: 'b', source: 'CHECKOUT', riderId: 'r2', provider: 'CASHFREE', state: 'PENDING' },
  ];
  assert.deepEqual(filterOperations(rows, ' PAY_abc ', 'RAZORPAY', 'REVIEW'), [rows[0]]);
  assert.deepEqual(filterOperations(rows, 'pay_abc', 'CASHFREE', ''), []);
  assert.deepEqual(filterOperations(rows, 'r2', '', 'PENDING'), [rows[1]]);
  assert.deepEqual(filterOperations(rows, '', '', ''), rows);
});

test('CSV exports escape quotes, multiline fields and spreadsheet formulas', async () => {
  const { operationsCsv } = await import('../../../src/app/components/payment-operations-model.ts');
  assert.equal(operationsCsv([{ id: '=CMD()', reason: 'a,"b"\nc' }]), '"id","reason"\r\n"\'=CMD()","a,""b""\nc"');
  assert.match(operationsCsv([{ reference: ' +SUM(1)', amount: '10.00' }]), /"' \+SUM/);
});
