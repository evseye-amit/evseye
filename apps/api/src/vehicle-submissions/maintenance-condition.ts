import { BadRequestException } from '@nestjs/common';
import type { MechanicReportDto } from './submission.dto.js';

export function maintenanceCondition(input: MechanicReportDto) {
  if (
    !['AVAILABLE', 'MAINTENANCE', 'BROKEN', 'AWAITING_PARTS'].includes(
      input.fleetStatus,
    )
  )
    throw new BadRequestException(
      'Select the fleet status before completing the mechanic report.',
    );
  if (input.fleetStatus === 'AVAILABLE') {
    if (!input.safeForReuse || !input.checksComplete)
      throw new BadRequestException(
        'Available requires completed checks and safe for reuse.',
      );
  }
  return { fleetStatus: input.fleetStatus };
}
