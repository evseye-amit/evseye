import 'reflect-metadata';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator.js';
import { describe, expect, it, vi } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import {
  RazorpayDeploymentController,
  RazorpayWebhookController,
  VerifyRazorpayDeploymentDto,
} from './razorpay-deployment.controller.js';

describe('Razorpay deployment endpoints', () => {
  it('uses authenticated client and Rider identity without accepting a caller amount', async () => {
    const service = {
      createOrder: vi
        .fn()
        .mockResolvedValue({ orderId: 'order_1', amount: 135000 }),
    };
    const clients = { requireClientId: vi.fn().mockReturnValue('client') };
    const controller = new RazorpayDeploymentController(
      service as never,
      clients as never,
    );
    const user = { id: 'user', clientId: 'client', roles: ['RIDER'] } as const;
    expect(await controller.order(user as never, 'allocation')).toEqual({
      data: { orderId: 'order_1', amount: 135000 },
    });
    expect(service.createOrder).toHaveBeenCalledWith(
      'client',
      'user',
      'allocation',
    );
    expect(
      Reflect.getMetadata(ROLES_KEY, RazorpayDeploymentController),
    ).toEqual(['RIDER']);
  });
  it('validates the callback and rejects client-supplied amount fields', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const valid = {
      razorpayOrderId: 'order_1',
      razorpayPaymentId: 'pay_1',
      razorpaySignature: 'a'.repeat(64),
    };
    await expect(
      pipe.transform(valid, {
        type: 'body',
        metatype: VerifyRazorpayDeploymentDto,
      }),
    ).resolves.toMatchObject(valid);
    await expect(
      pipe.transform(
        { ...valid, amount: 1 },
        { type: 'body', metatype: VerifyRazorpayDeploymentDto },
      ),
    ).rejects.toThrow();
    await expect(
      pipe.transform(
        { ...valid, razorpaySignature: 'fake' },
        { type: 'body', metatype: VerifyRazorpayDeploymentDto },
      ),
    ).rejects.toThrow();
  });
  it('requires raw webhook bytes and forwards signature/event headers without user authentication', () => {
    const service = { webhook: vi.fn().mockReturnValue({ received: true }) };
    const controller = new RazorpayWebhookController(service as never);
    expect(() => controller.webhook({} as never, 'signature', 'event')).toThrow(
      'Raw webhook body',
    );
    const raw = Buffer.from('{ "event": "payment.captured" }');
    expect(
      controller.webhook({ rawBody: raw } as never, 'signature', 'event'),
    ).toEqual({ received: true });
    expect(service.webhook).toHaveBeenCalledWith(raw, 'signature', 'event');
  });
});
