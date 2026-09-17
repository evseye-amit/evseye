import { Module } from '@nestjs/common';
import { ClientResolverService } from './client-resolver.service.js';
@Module({
  providers: [ClientResolverService],
  exports: [ClientResolverService],
})
export class ClientResolutionModule {}
