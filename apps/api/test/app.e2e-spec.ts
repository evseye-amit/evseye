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

  it('allows preflight requests from the configured operations web origin', () => {
    return request(app.getHttpServer())
      .options('/api/v1/riders')
      .set('Origin', 'http://localhost:3001')
      .set('Access-Control-Request-Method', 'GET')
      .expect(204)
      .expect('access-control-allow-origin', 'http://localhost:3001')
      .expect((response) => {
        expect(response.headers['access-control-allow-methods']).toContain(
          'GET',
        );
      });
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

  it('does not authorize preflight requests from an unconfigured browser origin', () => {
    return request(app.getHttpServer())
      .options('/api/v1/riders')
      .set('Origin', 'https://untrusted.example')
      .set('Access-Control-Request-Method', 'GET')
      .expect((response) => {
        expect(response.headers['access-control-allow-origin']).toBeUndefined();
      });
  });

  it('rate limits protected APIs while keeping health checks available', async () => {
    await request(app.getHttpServer()).get('/api/v1/riders').expect(401);
    await request(app.getHttpServer()).get('/api/v1/riders').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/riders')
      .expect(429)
      .expect('x-request-id', /.+/)
      .expect('retry-after', /[1-9]\d*/)
      .expect((response) => {
        expect(response.body).toMatchObject({
          error: {
            code: 'HTTP_ERROR',
            message: 'ThrottlerException: Too Many Requests',
          },
          requestId: expect.any(String),
        });
      });

    await request(app.getHttpServer()).get('/health').expect(200);
    await request(app.getHttpServer()).get('/health').expect(200);
    await request(app.getHttpServer()).get('/health').expect(200);
  });

  afterEach(async () => {
    await app.close();
  });
});
