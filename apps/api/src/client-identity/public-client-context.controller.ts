import { Controller, Get, Header, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ClientBrandingService } from './client-branding.service.js';
import { ClientResolverService } from './client-resolver.service.js';

@Controller('public')
export class PublicClientContextController {
  constructor(
    private readonly resolver: ClientResolverService,
    private readonly branding: ClientBrandingService,
  ) {}

  @Get('client-context')
  @Header('Cache-Control', 'no-store')
  async context(@Req() request: FastifyRequest) {
    return {
      data: await this.branding.context(
        (await this.resolver.fromRequest(request))?.clientId,
      ),
    };
  }
}
