import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ClientUsersController } from './client-users.controller.js';
import { ClientUsersService } from './client-users.service.js';
@Module({
  imports: [AuthModule],
  controllers: [ClientUsersController],
  providers: [ClientUsersService],
})
export class ClientUsersModule {}
