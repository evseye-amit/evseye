import { BadRequestException, Injectable } from '@nestjs/common';
import { FleetStatus } from '@prisma/client';

const transitions: Readonly<Record<FleetStatus, readonly FleetStatus[]>> = {
  PENDING_ACTIVATION: [
    FleetStatus.MAINTENANCE,
    FleetStatus.BROKEN,
    FleetStatus.AWAITING_PARTS,
    FleetStatus.OUT_OF_SERVICE,
  ],
  IN_TRANSIT: [
    FleetStatus.PENDING_ACTIVATION,
    FleetStatus.MAINTENANCE,
    FleetStatus.BROKEN,
    FleetStatus.AWAITING_PARTS,
    FleetStatus.OUT_OF_SERVICE,
  ],
  AVAILABLE: [
    FleetStatus.RESERVED,
    FleetStatus.MAINTENANCE,
    FleetStatus.BROKEN,
    FleetStatus.AWAITING_PARTS,
    FleetStatus.OUT_OF_SERVICE,
  ],
  RESERVED: [
    FleetStatus.AVAILABLE,
    FleetStatus.ALLOCATION_IN_PROGRESS,
    FleetStatus.MAINTENANCE,
    FleetStatus.BROKEN,
    FleetStatus.AWAITING_PARTS,
  ],
  ALLOCATION_IN_PROGRESS: [FleetStatus.ALLOCATED, FleetStatus.AVAILABLE],
  ALLOCATED: [FleetStatus.IN_USE, FleetStatus.DEALLOCATION_IN_PROGRESS],
  IN_USE: [FleetStatus.DEALLOCATION_IN_PROGRESS, FleetStatus.MAINTENANCE],
  DEALLOCATION_IN_PROGRESS: [
    FleetStatus.INSPECTION_PENDING,
    FleetStatus.IN_USE,
  ],
  INSPECTION_PENDING: [
    FleetStatus.AVAILABLE,
    FleetStatus.MAINTENANCE,
    FleetStatus.BROKEN,
    FleetStatus.AWAITING_PARTS,
  ],
  MAINTENANCE: [
    FleetStatus.PENDING_ACTIVATION,
    FleetStatus.AVAILABLE,
    FleetStatus.BROKEN,
    FleetStatus.AWAITING_PARTS,
    FleetStatus.OUT_OF_SERVICE,
  ],
  BROKEN: [
    FleetStatus.MAINTENANCE,
    FleetStatus.AWAITING_PARTS,
    FleetStatus.OUT_OF_SERVICE,
  ],
  AWAITING_PARTS: [
    FleetStatus.MAINTENANCE,
    FleetStatus.PENDING_ACTIVATION,
    FleetStatus.BROKEN,
    FleetStatus.AVAILABLE,
    FleetStatus.OUT_OF_SERVICE,
  ],
  OUT_OF_SERVICE: [
    FleetStatus.MAINTENANCE,
    FleetStatus.PENDING_ACTIVATION,
    FleetStatus.AVAILABLE,
  ],
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
