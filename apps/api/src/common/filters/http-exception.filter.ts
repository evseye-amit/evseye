import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { requestLocale } from '../locale.js';
import { localizeApiError } from '../mobile-error-translations.js';
import { Prisma } from '@prisma/client';

function getExceptionMessage(exceptionResponse: unknown): string {
  if (typeof exceptionResponse === 'string') {
    return exceptionResponse;
  }

  if (
    typeof exceptionResponse === 'object' &&
    exceptionResponse !== null &&
    'message' in exceptionResponse
  ) {
    const { message } = exceptionResponse as { message: unknown };

    if (typeof message === 'string') {
      return message;
    }

    if (Array.isArray(message)) {
      return message
        .filter((item): item is string => typeof item === 'string')
        .join('; ');
    }
  }

  return 'Internal server error';
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if ((exception instanceof Prisma.PrismaClientKnownRequestError || exception instanceof Prisma.PrismaClientUnknownRequestError) && exception.message.includes('PREPARATION_QC_REQUIRED:')) {
      exception = new HttpException({ code: 'PREPARATION_QC_REQUIRED', message: 'Scooter requires current preparation and QC approval before allocation or handover.' }, HttpStatus.CONFLICT);
    }
    if ((exception instanceof Prisma.PrismaClientKnownRequestError || exception instanceof Prisma.PrismaClientUnknownRequestError) && exception.message.includes('FLEET_ALLOCATION_BLOCKED:')) {
      exception = new HttpException({ code: 'FLEET_ALLOCATION_BLOCKED', message: 'Allocation is administratively disabled for this scooter.' }, HttpStatus.CONFLICT);
    }
    const context = host.switchToHttp();
    const response = context.getResponse<FastifyReply>();
    const request = context.getRequest<FastifyRequest>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const message = getExceptionMessage(exceptionResponse);
    const domainCode = typeof exceptionResponse === 'object' && exceptionResponse !== null && 'code' in exceptionResponse && typeof exceptionResponse.code === 'string' && /^[A-Z][A-Z0-9_]{2,80}$/.test(exceptionResponse.code) ? exceptionResponse.code : undefined;
    const locale = requestLocale(request.headers['accept-language']);

    if (!(exception instanceof HttpException)) {
      this.logger.error(
        { event: 'unhandled_request_exception', requestId: request.id, method: request.method, route: request.routeOptions?.url ?? request.url?.split('?')[0] },
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.header('Content-Language', locale).header('Vary', 'Accept-Language').status(status).send({
      error: {
        code: domainCode ?? (exception instanceof HttpException ? 'HTTP_ERROR' : 'INTERNAL_ERROR'),
        message: localizeApiError(message, locale),
      },
      requestId: request.id,
    });
  }
}
