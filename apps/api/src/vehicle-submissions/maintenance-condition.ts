import { BadRequestException } from '@nestjs/common';
import {
  MaintenanceIssueStatus,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import type { MechanicReportDto } from './submission.dto.js';

export function maintenanceCondition(input: MechanicReportDto, scope: string) {
  if (
    !['AVAILABLE', 'MAINTENANCE', 'BROKEN', 'AWAITING_PARTS'].includes(
      input.fleetStatus,
    )
  )
    throw new BadRequestException(
      'Select the fleet status before completing the mechanic report.',
    );
  if (!Array.isArray(input.issues) || input.issues.length > 50)
    throw new BadRequestException(
      'Provide a list of up to 50 maintenance issues.',
    );
  const issues = input.issues.map((issue, index) => {
    if (
      !Object.values(MaintenanceIssueStatus).includes(issue.status) ||
      !issue.description?.trim() ||
      !Array.isArray(issue.evidencePhotoIds) ||
      !issue.evidencePhotoIds.length
    )
      throw new BadRequestException(
        'Every maintenance issue needs a status, description and evidence.',
      );
    const key = createHash('sha256').update(`${scope}:${index}`).digest('hex');
    return {
      issueId:
        issue.issueId ??
        `${key.slice(0, 8)}-${key.slice(8, 12)}-4${key.slice(13, 16)}-a${key.slice(17, 20)}-${key.slice(20, 32)}`,
      description: issue.description.trim(),
      status: issue.status,
      evidencePhotoIds: [...new Set(issue.evidencePhotoIds)].sort(),
      requiredParts: issue.requiredParts?.trim() || null,
      penaltyFindingId: issue.penaltyFindingId ?? null,
    };
  });
  if (new Set(issues.map((issue) => issue.issueId)).size !== issues.length)
    throw new BadRequestException(
      'Each maintenance issue must have a unique ID.',
    );
  const blocking = issues.some((issue) => issue.status !== 'RESOLVED');
  if (input.fleetStatus === 'AVAILABLE') {
    if (!input.safeForReuse || !input.checksComplete || blocking)
      throw new BadRequestException(
        'Available requires completed checks, safe for reuse and all issues resolved.',
      );
  } else if (!issues.length) {
    throw new BadRequestException(
      'A maintenance status requires at least one described issue.',
    );
  }
  if (
    input.fleetStatus === 'AWAITING_PARTS' &&
    !issues.some((issue) => issue.status !== 'RESOLVED' && issue.requiredParts)
  )
    throw new BadRequestException(
      'Describe the required parts while awaiting parts.',
    );
  return { fleetStatus: input.fleetStatus, issues };
}
