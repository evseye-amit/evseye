import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IsBoolean, IsInt, Max, Min } from 'class-validator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ClientContextService } from '../auth/client-context.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { DeploymentAutoPayPolicyService } from './deployment-autopay-policy.service.js';

class UpdateDeploymentAutoPayPolicyDto {
  @IsBoolean() enabled!: boolean;
  @IsInt() @Min(0) @Max(2147483646) revision!: number;
}

@Controller('client/deployment-autopay-policy')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN)
export class DeploymentAutoPayPolicyController {
  constructor(
    private readonly policies: DeploymentAutoPayPolicyService,
    private readonly clients: ClientContextService,
  ) {}
  @Get()
  async get(@CurrentUser() user: AuthUser) {
    return {
      data: await this.policies.get(this.clients.requireClientId(user)),
    };
  }
  @Put()
  async set(
    @CurrentUser() user: AuthUser,
    @Body() body: UpdateDeploymentAutoPayPolicyDto,
  ) {
    return {
      data: await this.policies.set(
        this.clients.requireClientId(user),
        user.id,
        body,
      ),
    };
  }
  @Get('history')
  async history(
    @CurrentUser() user: AuthUser,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
  ) {
    if (page < 1 || page > 100000)
      throw new BadRequestException('Invalid page.');
    return {
      data: await this.policies.history(
        this.clients.requireClientId(user),
        page,
      ),
    };
  }
}
