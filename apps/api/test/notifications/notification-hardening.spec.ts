import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { NotificationWorker } from '../../src/notifications/notification.worker.js';
import { NotificationTopicWorker } from '../../src/notifications/notification-topic.worker.js';

describe('notification worker stage isolation', () => {
  it('still dispatches and finalizes after expansion fails, and releases its running guard', async () => {
    const worker = new NotificationWorker(
      {} as never,
      new ConfigService(),
      {} as never,
      { configured: false, send: async () => [] },
    );
    vi.spyOn((worker as any).logger, 'error').mockImplementation(
      () => undefined,
    );
    const expand = vi
      .spyOn(worker, 'expandRecipients')
      .mockRejectedValue(new Error('database failure'));
    const dispatch = vi.spyOn(worker, 'dispatch').mockResolvedValue(undefined);
    const finish = vi
      .spyOn(worker, 'finishMessages')
      .mockResolvedValue(undefined);
    await worker.tick();
    await worker.tick();
    expect(expand).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(finish).toHaveBeenCalledTimes(2);
  });
  it('continues topic dispatch when reconciliation fails', async () => {
    const worker = new NotificationTopicWorker({} as never, {} as never, {
      configured: false,
      send: async () => [],
    });
    vi.spyOn((worker as any).logger, 'error').mockImplementation(
      () => undefined,
    );
    vi.spyOn(worker, 'reconcile').mockRejectedValue(
      new Error('plan unavailable'),
    );
    const dispatch = vi.spyOn(worker, 'dispatch').mockResolvedValue(undefined);
    await worker.tick();
    expect(dispatch).toHaveBeenCalledOnce();
  });
  it('continues later project batches after a project dispatch failure', async () => {
    const worker = new NotificationWorker(
      {} as never,
      new ConfigService(),
      {} as never,
      {
        configured: true,
        send: async () => [],
        scopes: async () =>
          Array.from({ length: 6 }, (_, i) => ({ id: String(i) })),
      },
    );
    vi.spyOn((worker as any).logger, 'error').mockImplementation(
      () => undefined,
    );
    const dispatch = vi
      .spyOn(worker as any, 'dispatchScope')
      .mockImplementation(async (scope: any) => {
        if (scope.id === '0') throw new Error('project unavailable');
      });
    await worker.dispatch();
    expect(dispatch).toHaveBeenCalledTimes(6);
    expect(dispatch).toHaveBeenLastCalledWith({ id: '5' });
  });
  it('does not overlap ticks while work is in flight', async () => {
    const worker = new NotificationWorker(
      {} as never,
      new ConfigService(),
      {} as never,
      { configured: false, send: async () => [] },
    );
    let release!: () => void;
    const expand = vi
      .spyOn(worker, 'expandRecipients')
      .mockImplementation(async () => {
        await new Promise<void>((r) => (release = r));
        return 0;
      });
    vi.spyOn(worker, 'dispatch').mockResolvedValue(undefined);
    vi.spyOn(worker, 'finishMessages').mockResolvedValue(undefined);
    const first = worker.tick();
    await worker.tick();
    expect(expand).toHaveBeenCalledOnce();
    release();
    await first;
  });
});
