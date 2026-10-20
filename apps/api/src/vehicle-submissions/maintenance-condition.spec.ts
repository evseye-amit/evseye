import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { maintenanceCondition } from './maintenance-condition.js';
import { MechanicReportDto } from './submission.dto.js';
import { VehicleSubmissionService } from './submission.service.js';

const input = (
  fleetStatus: MechanicReportDto['fleetStatus'] = 'BROKEN',
): MechanicReportDto => ({
  stage: 'BASIC',
  fleetStatus,
  mechanicName: 'Mechanic',
  summary: 'Motor failure',
  safeForReuse: fleetStatus === 'AVAILABLE',
  unsafeReason: fleetStatus === 'AVAILABLE' ? undefined : 'Motor needs replacement',
  checksComplete: true,
  evidencePhotoIds: ['11111111-1111-4111-a111-111111111111'],
  items: [],
});

describe('submission maintenance conditions', () => {
  it.each(['AVAILABLE', 'MAINTENANCE', 'BROKEN', 'AWAITING_PARTS'] as const)(
    'accepts %s without maintenance issues',
    (fleetStatus) => {
      const condition = maintenanceCondition(input(fleetStatus));
      expect(condition).toEqual({ fleetStatus });
      expect(condition).not.toHaveProperty('issues');
    },
  );

  it('requires completed checks and safe reuse for AVAILABLE', () => {
    const dto = input('AVAILABLE');
    dto.checksComplete = false;
    expect(() => maintenanceCondition(dto)).toThrow(
      'completed checks',
    );

    dto.checksComplete = true;
    dto.safeForReuse = false;
    expect(() => maintenanceCondition(dto)).toThrow('safe for reuse');
  });

  it('validates fleet status and report fields at the API boundary', async () => {
    expect(
      await validate(plainToInstance(MechanicReportDto, input())),
    ).toHaveLength(0);
    const bad = {
      ...input(),
      fleetStatus: 'MECHANICALLY_OK',
      issues: [{ description: 'legacy issue' }],
    };
    expect(
      (await validate(plainToInstance(MechanicReportDto, bad))).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await validate(plainToInstance(MechanicReportDto, bad), {
          whitelist: true,
          forbidNonWhitelisted: true,
        })
      ).some((error) => error.property === 'issues'),
    ).toBe(true);
  });

  it('requires What needs work for non-AVAILABLE reports even when marked safe for reuse', async () => {
    const service = new VehicleSubmissionService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const dto = input('BROKEN');
    dto.unsafeReason = undefined;
    await expect(
      service.recordReport(
        'client-id',
        {} as never,
        'submission-id',
        dto,
        'unsafe-reason-key',
      ),
    ).rejects.toThrow('what needs work');
  });

  it('confirms a non-AVAILABLE BASIC report once and completes mechanic checks', async () => {
    const actor = {
      id: 'manager-id',
      roles: ['FLEET_MANAGER'],
    } as never;
    const submission = {
      id: 'submission-id',
      fleetId: 'fleet-id',
      allocationId: 'allocation-id',
      inspectionId: 'inspection-id',
      hubId: 'hub-id',
      riderId: 'rider-id',
      status: 'SUBMITTED',
      requiredPhotoTypes: [],
    };
    const row = {
      id: 'report-id',
      status: 'SUBMITTED',
      submissionId: submission.id,
      stage: 'BASIC',
      fleetStatus: 'BROKEN',
      checksComplete: false,
      safeForReuse: true,
      unsafeReason: 'Motor needs replacement',
      digest: 'report-digest',
      riderOtpRequestId: null,
      riderVerifiedUserId: null,
      teamLeadOtpRequestId: null,
      teamLeadVerifiedUserId: null,
      summary: 'Motor needs replacement',
      totalAmount: { toFixed: () => '0.00' },
    };
    const tx = {
      $queryRaw: vi.fn(),
      vehicleSubmissionReport: {
        findFirst: vi.fn().mockResolvedValue(row),
        update: vi.fn().mockResolvedValue({
          ...row,
          status: 'POSTED',
          riderBypassReason: 'Rider unavailable',
          teamLeadBypassReason: 'Lead unavailable',
        }),
      },
      vehicleSubmission: {
        update: vi.fn().mockResolvedValue({
          ...submission,
          status: 'CONFIRMED',
          mechanicChecksComplete: true,
        }),
      },
      allocation: { count: vi.fn().mockResolvedValue(0) },
      fleet: {
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValueOnce({
            status: 'MAINTENANCE',
            allocationBlockedByAdmin: false,
          })
          .mockResolvedValueOnce({ status: 'BROKEN' }),
        update: vi.fn().mockResolvedValue({ status: 'BROKEN' }),
      },
      fleetStatusHistory: { create: vi.fn() },
      otpRequest: { updateMany: vi.fn() },
    };
    const db = {
      vehicleSubmissionReport: {
        findMany: vi.fn().mockResolvedValue([{ ...row, status: 'POSTED' }]),
      },
      photo: { findMany: vi.fn().mockResolvedValue([]) },
      rider: { findFirst: vi.fn().mockResolvedValue(null) },
      hub: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new VehicleSubmissionService(
      db as never,
      {} as never,
      {} as never,
      {} as never,
    );
    vi.spyOn(service as any, 'reportAccess').mockResolvedValue({
      submission,
    });
    vi.spyOn(service as any, 'assertReportEvidence').mockResolvedValue(
      undefined,
    );
    vi.spyOn(service as any, 'recipients').mockResolvedValue({
      rider: { id: 'rider-id', phone: '9999999999' },
      teamLead: { id: 'lead-id', phone: '8888888888' },
    });
    vi.spyOn(service as any, 'ensurePenaltyPayment').mockResolvedValue({
      chargeId: null,
      paymentRequest: null,
    });
    vi.spyOn(service as any, 'completePhysicalSubmission').mockResolvedValue(
      undefined,
    );
    vi.spyOn(service as any, 'audit').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'transaction').mockImplementation(
      ((fn: (value: typeof tx) => Promise<unknown>) => fn(tx)) as any,
    );

    await service.confirm('client-id', actor, row.id, {
      riderBypassReason: 'Rider unavailable',
      teamLeadBypassReason: 'Lead unavailable',
    });

    expect(tx.vehicleSubmission.update).toHaveBeenCalledWith({
      where: { id: submission.id },
      data: expect.objectContaining({
        status: 'CONFIRMED',
        mechanicChecksComplete: true,
      }),
    });
    expect(tx.fleet.update).toHaveBeenCalledWith({
      where: { id: submission.fleetId },
      data: {
        status: 'BROKEN',
        allocationEnabled: false,
        readinessApprovedPreparationId: null,
      },
    });

    vi.spyOn(service as any, 'accessible').mockResolvedValue({
      ...submission,
      status: 'CONFIRMED',
      mechanicChecksComplete: true,
    });
    const viewed = await service.get('client-id', actor, submission.id);
    expect(viewed).toMatchObject({
      mechanicChecksComplete: true,
      nextAction: 'COMPLETE',
    });
    expect(viewed.reports[0]).toMatchObject({ fleetStatus: 'BROKEN' });
    expect(viewed).not.toHaveProperty('maintenanceIssues');
    expect(viewed.reports[0]).not.toHaveProperty('issues');
  });
});
