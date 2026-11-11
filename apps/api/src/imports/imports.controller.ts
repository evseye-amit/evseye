import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { ClientContextService } from '../auth/client-context.service.js';
import { ImportsService } from './imports.service.js';
@Controller('imports')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN)
export class ImportsController {
  constructor(private readonly imports: ImportsService, private readonly clients: ClientContextService) {}
  @Post('workbooks') create(@CurrentUser() user: AuthUser, @Body() body: { filename: string; metadata?: Record<string, unknown> }) { return this.imports.createParent(this.clients.requireClientId(user), user.id, body.filename, body.metadata ?? {}).then((data) => ({ data })); }
}
