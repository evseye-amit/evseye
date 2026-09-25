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
        'Unhandled request exception',
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
