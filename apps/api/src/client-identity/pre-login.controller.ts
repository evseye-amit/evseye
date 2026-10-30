import { Controller, Get, Header, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ClientResolverService } from './client-resolver.service.js';
import { PreLoginQuery } from './pre-login.dto.js';
import { PreLoginService } from './pre-login.service.js';
import { languageCatalog } from '../common/language-catalog.js';

@Controller('public/app')
export class PublicPreLoginController {
  constructor(
    private readonly service: PreLoginService,
    private readonly resolver: ClientResolverService,
  ) {}

  @Get('languages')
  languages() {
    return { data: languageCatalog };
  }

  @Get('bootstrap')
  @Header('Cache-Control', 'no-store')
  async bootstrap(
    @Query() query: PreLoginQuery,
    @Req() request: FastifyRequest,
  ) {
    const host = await this.resolver.fromRequest(request);
    return {
      data: await this.service.publicBootstrap(
        query.companyCode,
        query.appCode,
        query.role,
        host?.clientId,
      ),
    };
  }
}
