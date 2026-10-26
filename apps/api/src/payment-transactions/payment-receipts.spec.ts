import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MediaService } from '../media/media.service.js';
import { PaymentReceiptUploadDto, PaymentReviewDto, RejectPaymentDto } from './payment-transactions.dto.js';

describe('payment receipt validation and integrity', () => {
  it('rejects whitespace reasons, missing/stale-shaped versions, unsupported files and oversized images', async () => {
    expect(await validate(plainToInstance(RejectPaymentDto, { reason: '   ', expectedVersion: 1 }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(PaymentReviewDto, {}))).not.toHaveLength(0);
    expect(await validate(plainToInstance(PaymentReviewDto, { expectedVersion: -1 }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(PaymentReceiptUploadDto, { fileName: 'receipt.pdf', mimeType: 'application/pdf', sizeBytes: 10 }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(PaymentReceiptUploadDto, { fileName: 'receipt.jpg', mimeType: 'image/jpeg', sizeBytes: 6*1024*1024 }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(RejectPaymentDto, { reason: '  Funds not received  ', expectedVersion: 1 }))).toHaveLength(0);
  });
  const photo = { id: 'photo', clientId: 'client', workFlowType: 'PAYMENT', subjectType: 'DEPLOYMENT', entityId: 'payment', uploadedById: 'rider', mimeType: 'image/jpeg', sizeBytes: 100, status: 'PENDING_UPLOAD', objectKey: 'original.jpg' };
  it('rejects a different uploader, transaction or source before touching storage', async () => {
    const storage = { assertObjectExists: vi.fn() };
    const db = { photo: { findFirst: vi.fn().mockResolvedValue(photo) } };
    const service = new MediaService(db as never, storage as never);
    await expect(service.completePayment('client', 'PAYMENT_DEPLOYMENT', 'payment', 'photo', 'other-rider')).rejects.toThrow('not found');
    await expect(service.completePayment('client', 'PAYMENT_DEPLOYMENT', 'other-payment', 'photo', 'rider')).rejects.toThrow('not found');
    await expect(service.completePayment('client', 'PAYMENT_COLLECTION', 'payment', 'photo', 'rider')).rejects.toThrow('not found');
    expect(storage.assertObjectExists).not.toHaveBeenCalled();
  });
  it('never completes a receipt when the uploaded bytes fail storage validation', async () => {
    const db = { photo: { findFirst: vi.fn().mockResolvedValue(photo), updateMany: vi.fn() } };
    const storage = { assertObjectExists: vi.fn().mockRejectedValue(new Error('Invalid image bytes')), sealObject: vi.fn() };
    const service = new MediaService(db as never, storage as never);
    await expect(service.completePayment('client', 'PAYMENT_DEPLOYMENT', 'payment', 'photo', 'rider')).rejects.toThrow('Invalid image bytes');
    expect(storage.sealObject).not.toHaveBeenCalled(); expect(db.photo.updateMany).not.toHaveBeenCalled();
  });
  it('validates the sealed copy before publishing a receipt and permits safe completion retries', async () => {
    const db = { photo: { findFirst: vi.fn().mockResolvedValue(photo), updateMany: vi.fn() } };
    const storage = { assertObjectExists: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Sealed image invalid')), sealObject: vi.fn() };
    const service = new MediaService(db as never, storage as never);
    await expect(service.completePayment('client', 'PAYMENT_DEPLOYMENT', 'payment', 'photo', 'rider')).rejects.toThrow('Sealed image invalid');
    expect(db.photo.updateMany).not.toHaveBeenCalled();
    db.photo.findFirst.mockResolvedValue({ ...photo, status: 'COMPLETE' });
    expect((await service.completePayment('client', 'PAYMENT_DEPLOYMENT', 'payment', 'photo', 'rider')).status).toBe('COMPLETE');
    expect(storage.sealObject).toHaveBeenCalledTimes(1);
  });
});

describe('private receipt content delivery', () => {
  const photo = { id: 'photo', clientId: 'client', workFlowType: 'PAYMENT', subjectType: 'DEPLOYMENT', entityId: 'payment', mimeType: 'image/png', sizeBytes: 100, status: 'COMPLETE', objectKey: 'sealed.png' };
  it('requires a completed receipt from the same client, payment and source before reading bytes', async () => {
    const db = { photo: { findFirst: vi.fn().mockResolvedValue(photo) } };
    const storage = { readObject: vi.fn().mockResolvedValue(Buffer.from('png')) };
    const media = new MediaService(db as never, storage as never);
    expect(await media.paymentContent('client', 'PAYMENT_DEPLOYMENT', 'payment', 'photo')).toEqual({ bytes: Buffer.from('png'), mimeType: 'image/png', filename: 'payment-receipt-photo.png' });
    expect(db.photo.findFirst).toHaveBeenCalledWith({ where: { id: 'photo', clientId: 'client' } });
    expect(storage.readObject).toHaveBeenCalledWith('sealed.png', 100);
    storage.readObject.mockClear();
    await expect(media.paymentContent('client', 'PAYMENT_DEPLOYMENT', 'other-payment', 'photo')).rejects.toThrow('not found');
    await expect(media.paymentContent('client', 'PAYMENT_COLLECTION', 'payment', 'photo')).rejects.toThrow('not found');
    db.photo.findFirst.mockResolvedValue({ ...photo, status: 'PENDING_UPLOAD' });
    await expect(media.paymentContent('client', 'PAYMENT_DEPLOYMENT', 'payment', 'photo')).rejects.toThrow('not available');
    db.photo.findFirst.mockResolvedValue(null as never);
    await expect(media.paymentContent('other-client', 'PAYMENT_DEPLOYMENT', 'payment', 'photo')).rejects.toThrow('not found');
    expect(storage.readObject).not.toHaveBeenCalled();
  });
  it('rejects unsupported receipt types and oversized metadata before touching storage', async () => {
    const db = { photo: { findFirst: vi.fn() } }, storage = { readObject: vi.fn() };
    const media = new MediaService(db as never, storage as never);
    for (const invalid of [{ mimeType: 'text/html' }, { sizeBytes: 6 * 1024 * 1024 }]) {
      db.photo.findFirst.mockResolvedValue({ ...photo, ...invalid });
      await expect(media.paymentContent('client', 'PAYMENT_DEPLOYMENT', 'payment', 'photo')).rejects.toThrow('unsupported type or size');
    }
    expect(storage.readObject).not.toHaveBeenCalled();
  });
});
