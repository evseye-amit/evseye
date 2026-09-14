import { IsEnum } from 'class-validator';
import {
  ClientOnboardingStep,
  ClientOnboardingStepStatus,
} from '@prisma/client';

export class SaveOnboardingStepDto {
  @IsEnum(ClientOnboardingStep)
  step!: ClientOnboardingStep;

  @IsEnum(ClientOnboardingStepStatus)
  status!: ClientOnboardingStepStatus;
}

export class SkipOnboardingStepDto {
  @IsEnum(ClientOnboardingStep)
  step!: ClientOnboardingStep;
}
