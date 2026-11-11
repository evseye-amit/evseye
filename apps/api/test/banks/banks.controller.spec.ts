import 'reflect-metadata';
import { UserRole } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { describe, expect, it, vi } from 'vitest';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants.js';
import { ROLES_KEY } from '../../src/auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../../src/auth/guards/access-token.guard.js';
import { RolesGuard } from '../../src/auth/guards/roles.guard.js';
import { ClientResolverService } from '../../src/client-identity/client-resolver.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { completeSwaggerDocument } from '../../src/swagger.js';
import { IfscBankController } from '../../src/banks/banks.controller.js';
import { IfscBankService } from '../../src/banks/banks.service.js';

describe('IfscBankController', () => {
  it('returns bank details inside the standard data envelope', async () => {
    const details = { ifsc: 'HDFC0000001', bankName: 'HDFC Bank' };
    const service = { lookup: vi.fn().mockResolvedValue(details) };
    const controller = new IfscBankController(service as never);

    await expect(controller.lookup('hdfc0000001')).resolves.toEqual({
      data: details,
    });
    expect(service.lookup).toHaveBeenCalledWith('hdfc0000001');
  });

  it('registers the authenticated rider and fleet-manager mobile boundary', () => {
    const method = IfscBankController.prototype.lookup;
    expect(Reflect.getMetadata(PATH_METADATA, IfscBankController)).toBe('banks');
    expect(Reflect.getMetadata(PATH_METADATA, method)).toBe('ifsc/:ifsc');
    expect(Reflect.getMetadata(METHOD_METADATA, method)).toBe(0);
    expect(Reflect.getMetadata(ROLES_KEY, IfscBankController)).toEqual([
      UserRole.RIDER,
      UserRole.FLEET_MANAGER,
    ]);
    expect(new Reflector().get('__guards__', IfscBankController)).toBeDefined();
  });

  it('generates the data envelope and shared error envelope in OpenAPI', async () => {
    const testingModuleBuilder = Test.createTestingModule({
      controllers: [IfscBankController],
      providers: [
        IfscBankService,
        AccessTokenGuard,
        RolesGuard,
        { provide: JwtService, useValue: {} },
        { provide: ConfigService, useValue: {} },
        { provide: PrismaService, useValue: {} },
        { provide: ClientResolverService, useValue: {} },
      ],
    });
    const testingModule = await testingModuleBuilder
      .overrideGuard(AccessTokenGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = testingModule.createNestApplication(new FastifyAdapter());
    await app.init();
    const document = completeSwaggerDocument(
      SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('Test').setVersion('1').build(),
      ),
    );
    const operation = document.paths['/banks/ifsc/{ifsc}']?.get;

    expect(operation?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: { type: 'object', required: ['data'] },
        },
      },
    });
    for (const status of ['400', '404', '502', '503']) {
      expect(operation?.responses[status]).toMatchObject({
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiErrorEnvelope' },
          },
        },
      });
    }
    await app.close();
  });
});
