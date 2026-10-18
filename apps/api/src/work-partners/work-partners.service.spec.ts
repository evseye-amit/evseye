import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { describe, expect, it, vi } from 'vitest';
import { WorkPartnersService } from './work-partners.service.js';

const duplicate = () =>
  new PrismaClientKnownRequestError('Duplicate', {
    code: 'P2002',
    clientVersion: '6.19.0',
  });

describe('WorkPartnersService', () => {
  it('normalizes master codes and defaults status to ACTIVE', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'master-1',
      code: 'PARTNER_1',
      name: 'Partner One',
      legalName: 'Partner One Legal',
      status: 'ACTIVE',
    });
    const prisma = {
      workPartnerMaster: { create },
    };
    const audit = { record: vi.fn().mockResolvedValue({}) };
    const service = new WorkPartnersService(prisma as never, audit as never);

    await expect(
      service.createMaster(
        { code: ' partner_1 ', name: ' Partner One ', legalName: ' Partner One Legal ' },
        'actor-1',
      ),
    ).resolves.toMatchObject({ id: 'master-1' });
    expect(create).toHaveBeenCalledWith({
      data: {
        code: 'PARTNER_1',
        name: 'Partner One',
        legalName: 'Partner One Legal',
        status: 'ACTIVE',
      },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WORK_PARTNER_MASTER_CREATED', actorId: 'actor-1' }),
    );
  });

  it('maps a duplicate master code to the public conflict message', async () => {
    const prisma = { workPartnerMaster: { create: vi.fn().mockRejectedValue(duplicate()) } };
    const service = new WorkPartnersService(prisma as never, { record: vi.fn() } as never);

    await expect(
      service.createMaster({ code: 'DUPLICATE', name: 'Name', legalName: 'Legal' }, 'actor-1'),
    ).rejects.toMatchObject({
      response: { message: 'Work partner code already exists.' },
    });
  });

  it('maps a duplicate client code to the exact tenant conflict message', async () => {
    const prisma = { clientWorkPartner: { create: vi.fn().mockRejectedValue(duplicate()) } };
    const service = new WorkPartnersService(prisma as never, { record: vi.fn() } as never);

    await expect(
      service.createClientPartner('client-1', { code: 'DUPLICATE', name: 'Name', legalName: 'Legal' }, 'actor-1'),
    ).rejects.toMatchObject({
      response: { message: 'Work partner code already exists for this client.' },
    });
  });

  it('denies a cross-client update without changing the hidden row', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const update = vi.fn();
    const prisma = { clientWorkPartner: { findFirst, update } };
    const service = new WorkPartnersService(prisma as never, { record: vi.fn() } as never);

    await expect(
      service.updateClientPartner('client-a', 'partner-b', { name: 'Replacement' }, 'actor-1'),
    ).rejects.toThrow('Work partner not found.');
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'partner-b', clientId: 'client-a' } });
    expect(update).not.toHaveBeenCalled();
  });

  it('copies only active masters as independent client rows and audits in the transaction', async () => {
    const auditCreate = vi.fn().mockResolvedValue({});
    const tx = {
      workPartnerMaster: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'master-1',
          code: 'PARTNER_1',
          name: 'Master Name',
          legalName: 'Master Legal',
          status: 'ACTIVE',
        }),
      },
      clientWorkPartner: {
        create: vi.fn().mockResolvedValue({
          id: 'client-partner-1',
          clientId: 'client-1',
          sourceMasterId: 'master-1',
          code: 'PARTNER_1',
          name: 'Master Name',
          legalName: 'Master Legal',
          status: 'ACTIVE',
        }),
      },
      auditLog: { create: auditCreate },
    };
    const prisma = {
      client: { findUnique: vi.fn().mockResolvedValue({ id: 'client-1' }) },
      $transaction: vi.fn().mockImplementation((fn: (value: typeof tx) => unknown) => fn(tx)),
    };
    const service = new WorkPartnersService(prisma as never, { record: vi.fn() } as never);

    await expect(service.copyMasterToClient('client-1', 'master-1', 'actor-1')).resolves.toMatchObject({
      clientId: 'client-1',
      sourceMasterId: 'master-1',
    });
    expect(tx.clientWorkPartner.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clientId: 'client-1',
        sourceMasterId: 'master-1',
        code: 'PARTNER_1',
        name: 'Master Name',
        legalName: 'Master Legal',
        status: 'ACTIVE',
      }),
    });
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'CLIENT_WORK_PARTNER_COPIED',
          clientId: 'client-1',
          actorId: 'actor-1',
        }),
      }),
    );
  });

  it('does not copy an inactive master', async () => {
    const tx = {
      workPartnerMaster: { findUnique: vi.fn().mockResolvedValue({ id: 'master-1', status: 'INACTIVE' }) },
      clientWorkPartner: { create: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      client: { findUnique: vi.fn().mockResolvedValue({ id: 'client-1' }) },
      $transaction: vi.fn().mockImplementation((fn: (value: typeof tx) => unknown) => fn(tx)),
    };
    const service = new WorkPartnersService(prisma as never, { record: vi.fn() } as never);

    await expect(service.copyMasterToClient('client-1', 'master-1', 'actor-1'))
      .rejects.toThrow('Inactive work partner cannot be copied.');
    expect(tx.clientWorkPartner.create).not.toHaveBeenCalled();
  });

  it('maps a transactional client duplicate to the tenant conflict without overwriting or auditing', async () => {
    const create = vi.fn().mockRejectedValue(duplicate());
    const auditCreate = vi.fn();
    const tx = {
      workPartnerMaster: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'master-1',
          code: 'PARTNER_1',
          name: 'Master Name',
          legalName: 'Master Legal',
          status: 'ACTIVE',
        }),
      },
      clientWorkPartner: { create },
      auditLog: { create: auditCreate },
    };
    const prisma = {
      client: { findUnique: vi.fn().mockResolvedValue({ id: 'client-1' }) },
      $transaction: vi.fn().mockImplementation((fn: (value: typeof tx) => unknown) => fn(tx)),
    };
    const service = new WorkPartnersService(prisma as never, { record: vi.fn() } as never);

    await expect(service.copyMasterToClient('client-1', 'master-1', 'actor-1')).rejects.toMatchObject({
      response: { message: 'Work partner code already exists for this client.' },
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
