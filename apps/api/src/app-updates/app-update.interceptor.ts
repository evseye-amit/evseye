import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { AppCheckDto } from './app-update.dto.js';
import { AppUpdateService } from './app-update.service.js';

export const APP_UPDATE_HEADERS = [
  'x-app-code',
  'x-app-platform',
  'x-app-id',
  'x-app-channel',
  'x-app-version',
  'x-app-build',
] as const;
const recoveryRoutes = new Set([
  '/api/v1/app-updates/check',
  '/api/v1/auth/logout',
  '/api/v1/auth/refresh',
]);

// Interceptors run after authentication guards; tenant identity is never taken from mobile headers.
@Injectable()
export class AppUpdateInterceptor implements NestInterceptor {
  constructor(private readonly updates: AppUpdateService) {}
  async intercept(context: ExecutionContext, next: CallHandler) {
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user?: AuthUser }>();
    if (
      !request.user?.clientId ||
      recoveryRoutes.has(request.routeOptions?.url ?? '')
    )
      return next.handle();
    const values = APP_UPDATE_HEADERS.map((header) => request.headers[header]);
    // Compatibility phase: requests without any metadata are legacy/browser requests.
    // This is a cooperative version gate, not proof of app identity or device attestation.
    if (values.every((value) => value === undefined)) return next.handle();
    if (!values.every((value) => typeof value === 'string' && value.length > 0))
      throw new BadRequestException({
        code: 'APP_METADATA_INVALID',
        message: 'Send all six app metadata headers together.',
      });
    const [appCode, platform, applicationId, channel, version, build] = values;
    const input = plainToInstance(AppCheckDto, {
      appCode,
      platform,
      applicationId,
      channel,
      installed: { version, build },
    });
    if (
      (await validate(input, { whitelist: true, forbidNonWhitelisted: true }))
        .length
    )
      throw new BadRequestException({
        code: 'APP_METADATA_INVALID',
        message: 'Invalid app metadata headers.',
      });
    const result = await this.updates.check(request.user.clientId, input);
    if (result.decision === 'required_update') {
      context
        .switchToHttp()
        .getResponse<FastifyReply>()
        .header('Cache-Control', 'no-store');
      throw new HttpException(
        {
          code: 'APP_UPDATE_REQUIRED',
          message: result.message ?? 'Update the application to continue.',
          issues: [result],
        },
        426,
      );
    }
    return next.handle();
  }
}
