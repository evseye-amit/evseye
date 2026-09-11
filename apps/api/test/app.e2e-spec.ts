import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApplication } from './../src/app.factory.js';

describe('Health endpoints (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createApplication();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect('x-request-id', /.+/)
      .expect({ data: { status: 'ok', service: 'evs-eye-api' } });
  });

  afterEach(async () => {
    await app.close();
  });
});
