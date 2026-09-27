import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { RewardPostingService } from './reward-posting.service.js';
import { RewardQualificationService } from './reward-qualification.service.js';
import { RewardService } from './reward.service.js';
import { RiderRewardController, ClientRewardController } from './rewards.controller.js';

@Module({
  imports: [AuthModule, WalletModule],
  controllers: [RiderRewardController, ClientRewardController],
  providers: [RewardPostingService, RewardQualificationService, RewardService],
  exports: [RewardPostingService, RewardQualificationService, RewardService],
})
export class RewardsModule {}
