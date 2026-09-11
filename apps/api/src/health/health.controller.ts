import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthService } from './health.service.js';

@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  health() {
    return this.healthService.liveness();
  }

  @Get('ready')
  async ready() {
    const readiness = await this.healthService.readiness();

    if (readiness.status !== 'ready') {
      throw new ServiceUnavailableException(readiness);
    }

    return readiness;
  }
}
