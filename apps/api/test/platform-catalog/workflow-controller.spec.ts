import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import request from 'supertest';
import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import { PlatformCatalogController } from '../../src/platform-catalog/platform-catalog.controller.js';
import { PlatformCatalogService } from '../../src/platform-catalog/platform-catalog.service.js';
import { CatalogRevisionService } from '../../src/platform-catalog/catalog-revision.service.js';
import { AccessTokenGuard } from '../../src/auth/guards/access-token.guard.js';
import { RolesGuard } from '../../src/auth/guards/roles.guard.js';

describe('Platform workflow revision HTTP endpoints', () => {
  let app: INestApplication;
  const revisions = vi.fn().mockResolvedValue([{ id: 'wf-1', version: 1 }]);
  const draft = vi.fn().mockResolvedValue({ id: 'wf-2', version: 2 });
  const publish = vi.fn().mockResolvedValue({ id: 'wf-2', version: 2, publishedAt: new Date() });
  const discard = vi.fn().mockResolvedValue({ discarded: true, version: 2 });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PlatformCatalogController],
      providers: [
        { provide: PlatformCatalogService, useValue: {} },
        { provide: CatalogRevisionService, useValue: {
          clientWorkflowRevisions: revisions, draftClientWorkflow: draft,
          publishClientWorkflow: publish, discardClientWorkflow: discard,
        } },
      ],
    }).overrideGuard(AccessTokenGuard).useValue({ canActivate: (context: any) => {
      context.switchToHttp().getRequest().user = { id: 'admin-1' }; return true;
    }}).overrideGuard(RolesGuard).useValue({ canActivate: () => true }).compile();
    app = module.createNestApplication(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(() => app.close());

  it('routes the complete workflow lifecycle through authenticated HTTP endpoints', async () => {
    await request(app.getHttpServer()).get('/platform/subscriptions/sub-1/workflow-revisions').expect(200)
      .expect({ data: [{ id: 'wf-1', version: 1 }] });
    await request(app.getHttpServer()).post('/platform/subscriptions/sub-1/workflow-revisions')
      .send({ overrides: [] }).expect(201).expect({ data: { id: 'wf-2', version: 2 } });
    await request(app.getHttpServer()).post('/platform/workflow-revisions/wf-2/publish')
      .expect(201).expect((response) => expect(response.body.data.id).toBe('wf-2'));
    await request(app.getHttpServer()).delete('/platform/workflow-revisions/wf-2')
      .expect(200).expect({ data: { discarded: true, version: 2 } });
    expect(draft).toHaveBeenCalledWith('sub-1', { overrides: [] }, 'admin-1');
    expect(publish).toHaveBeenCalledWith('wf-2', 'admin-1');
    expect(discard).toHaveBeenCalledWith('wf-2', 'admin-1');
  });
});
