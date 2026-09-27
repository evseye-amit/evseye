import { AuthModule } from '../auth/auth.module.js';
import { WalletBillingService } from './wallet-billing.service.js';
import { WalletBillingController } from './wallet-billing.controller.js';
import { Module } from '@nestjs/common';
import { SecurityDepositService } from './security-deposit.service.js';
import { WalletPolicyService } from './wallet-policy.service.js';
import { RiderWalletDepositController, WalletPhase2AdminController } from './wallet-phase2.controller.js';
import { WalletService } from './wallet.service.js';
import { RiderWalletController, WalletAdminController } from './wallet.controller.js';
import { WalletStatementService } from './wallet-statement.service.js';
@Module({ imports: [AuthModule], controllers: [RiderWalletController, WalletAdminController, RiderWalletDepositController, WalletPhase2AdminController, WalletBillingController], providers: [WalletService, SecurityDepositService, WalletPolicyService, WalletBillingService, WalletStatementService], exports: [WalletService, SecurityDepositService, WalletPolicyService, WalletBillingService, WalletStatementService] })
export class WalletModule {}
