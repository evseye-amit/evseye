import 'reflect-metadata';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ClientContextService } from '../auth/client-context.service.js';
import { ClientResolverService } from '../client-identity/client-resolver.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClientWorkPartnersController } from './client-work-partners.controller.js';
import { PlatformWorkPartnersController } from './platform-work-partners.controller.js';
import { WorkPartnersService } from './work-partners.service.js';

describe('work partner HTTP boundary', () => {
  const user: { id: string; clientId: string; roles: UserRole[] } = {
    id: 'actor-1',
    clientId: 'client-a',
    roles: [UserRole.CLIENT_ADMIN],
  };
  const service = {
    listMasters: vi.fn().mockResolvedValue([]),
    createMaster: vi.fn().mockResolvedValue({ id: 'master-1' }),
    updateMaster: vi.fn(),
    listClientPartners: vi.fn().mockResolvedValue([{ id: 'partner-a', clientId: 'client-a' }]),
    listActiveClientPartners: vi.fn().mockResolvedValue([]),
    listActiveMasters: vi.fn().mockResolvedValue([]),
    createClientPartner: vi.fn(),
    updateClientPartner: vi.fn(),
    copyMasterToClient: vi.fn(),
  };
  const clients = { requireClientId: vi.fn().mockReturnValue('client-a') };
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PlatformWorkPartnersController, ClientWorkPartnersController],
      providers: [
        { provide: WorkPartnersService, useValue: service },
        { provide: ClientContextService, useValue: clients },
        AccessTokenGuard,
        RolesGuard,
        Reflector,
        { provide: JwtService, useValue: {} },
        { provide: ConfigService, useValue: {} },
        { provide: PrismaService, useValue: {} },
        { provide: ClientResolverService, useValue: {} },
      ],
    })
      .overrideGuard(AccessTokenGuard)
      .useValue({
        canActivate: (context: { switchToHttp: () => { getRequest: () => { user: typeof user } } }) => {
          context.switchToHttp().getRequest().user = user;
          return true;
        },
      })
      .compile();
    app = module.createNestApplication(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('returns data envelopes, enforces roles, rejects PATCH code, and has no delete route', async () => {
    const wrongRole = await request(app.getHttpServer())
      .post('/api/v1/platform/work-partners')
      .send({ code: 'PARTNER_1', name: 'Partner', legalName: 'Partner Legal' });
    expect(wrongRole.status).toBe(403);

    user.roles.splice(0, user.roles.length, UserRole.SUPER_ADMIN);
    const created = await request(app.getHttpServer())
      .post('/api/v1/platform/work-partners')
      .send({ code: 'PARTNER_1', name: 'Partner', legalName: 'Partner Legal' });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ data: { id: 'master-1' } });

    const codeChange = await request(app.getHttpServer())
      .patch('/api/v1/platform/work-partners/master-1')
      .send({ code: 'CHANGED' });
    expect(codeChange.status).toBe(400);
    expect(service.updateMaster).not.toHaveBeenCalled();

    const deleted = await request(app.getHttpServer()).delete('/api/v1/platform/work-partners/master-1');
    expect(deleted.status).toBe(404);
  });

  it('uses the authenticated client for client lists even when a caller supplies another client query', async () => {
    user.roles.splice(0, user.roles.length, UserRole.CLIENT_ADMIN);
    const response = await request(app.getHttpServer())
      .get('/api/v1/client/work-partners?clientId=client-b')
      .expect(200);
    expect(response.body).toEqual({ data: [{ id: 'partner-a', clientId: 'client-a' }] });
    expect(clients.requireClientId).toHaveBeenCalledWith(expect.objectContaining({ id: 'actor-1' }));
    expect(service.listClientPartners).toHaveBeenCalledWith('client-a');
  });
});
