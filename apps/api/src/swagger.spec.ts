import { describe, expect, it } from 'vitest';
import type { OpenAPIObject } from '@nestjs/swagger';
import { completeSwaggerDocument } from './swagger.js';

describe('completeSwaggerDocument', () => {
  it('documents response envelopes and the correct authentication method', () => {
    const document = completeSwaggerDocument({
      openapi: '3.0.0',
      info: { title: 'EVs Eye API', version: '1.0' },
      servers: [],
      tags: [],
      components: {},
      paths: {
        '/api/v1/auth/otp/request': { post: { responses: { '202': { description: '' } } } },
        '/api/v1/riders': { get: { responses: { '200': { description: '' } } } },
        '/api/v1/iot/ingest': { post: { responses: { '202': { description: '' } } } },
      },
    } as OpenAPIObject);

    const login = document.paths['/api/v1/auth/otp/request']?.post;
    const riders = document.paths['/api/v1/riders']?.get;
    const ingest = document.paths['/api/v1/iot/ingest']?.post;
    expect(login?.security).toBeUndefined();
    expect(riders?.security).toEqual([{ bearer: [] }]);
    expect(ingest?.security).toEqual([{ deviceSecret: [] }]);
    expect(riders?.responses['200']).toMatchObject({
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiDataEnvelope' } } },
    });
    expect(riders?.responses.default).toMatchObject({
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiErrorEnvelope' } } },
    });
  });
});
