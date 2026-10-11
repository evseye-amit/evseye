import { Module } from '@nestjs/common';
import { WorkflowResolverService } from './workflow-resolver.service.js';

@Module({ providers: [WorkflowResolverService], exports: [WorkflowResolverService] })
export class WorkflowModule {}
