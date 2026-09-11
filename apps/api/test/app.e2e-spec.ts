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
      .expect('x-content-type-options', 'nosniff')
      .expect({ data: { status: 'ok', service: 'evs-eye-api' } });
  });

  it('returns the normalized error envelope and request ID for unauthenticated APIs', () => {
    return request(app.getHttpServer())
      .get('/api/v1/riders')
      .expect(401)
      .expect('x-request-id', /.+/)
      .expect((response) => {
        expect(response.body).toMatchObject({
          error: { code: 'HTTP_ERROR', message: 'Missing access token.' },
          requestId: expect.any(String),
        });
      });
  });

  it('allows the configured operations web origin', () => {
    return request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'http://localhost:3001')
      .expect(200)
      .expect('access-control-allow-origin', 'http://localhost:3001');
  });

  it('does not allow an unconfigured browser origin', () => {
    return request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'https://untrusted.example')
      .expect(200)
      .expect((response) => {
        expect(response.headers['access-control-allow-origin']).toBeUndefined();
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
