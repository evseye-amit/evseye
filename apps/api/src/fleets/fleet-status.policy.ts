import { BadRequestException, Injectable } from '@nestjs/common';
import { FleetStatus } from '@prisma/client';

const transitions: Readonly<Record<FleetStatus, readonly FleetStatus[]>> = {
  IN_TRANSIT: [
    FleetStatus.AVAILABLE,
    FleetStatus.MAINTENANCE,
    FleetStatus.OUT_OF_SERVICE,
  ],
  AVAILABLE: [
    FleetStatus.RESERVED,
    FleetStatus.MAINTENANCE,
    FleetStatus.OUT_OF_SERVICE,
  ],
  RESERVED: [
    FleetStatus.AVAILABLE,
    FleetStatus.ALLOCATION_IN_PROGRESS,
    FleetStatus.MAINTENANCE,
  ],
  ALLOCATION_IN_PROGRESS: [FleetStatus.ALLOCATED, FleetStatus.AVAILABLE],
  ALLOCATED: [FleetStatus.IN_USE, FleetStatus.DEALLOCATION_IN_PROGRESS],
  IN_USE: [FleetStatus.DEALLOCATION_IN_PROGRESS, FleetStatus.MAINTENANCE],
  DEALLOCATION_IN_PROGRESS: [
    FleetStatus.INSPECTION_PENDING,
    FleetStatus.IN_USE,
  ],
  INSPECTION_PENDING: [FleetStatus.AVAILABLE, FleetStatus.MAINTENANCE],
  MAINTENANCE: [FleetStatus.AVAILABLE, FleetStatus.OUT_OF_SERVICE],
  OUT_OF_SERVICE: [FleetStatus.MAINTENANCE, FleetStatus.AVAILABLE],
};

@Injectable()
export class FleetStatusPolicy {
  assertTransition(from: FleetStatus, to: FleetStatus): void {
    if (from === to || !transitions[from].includes(to)) {
      throw new BadRequestException(
        `Fleet cannot transition from ${from} to ${to}.`,
      );
    }
  }
}
