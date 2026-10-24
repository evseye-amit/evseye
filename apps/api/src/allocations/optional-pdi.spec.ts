import { ValidationPipe } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MobileDeploymentService } from './mobile-deployment.service.js';
import { SubmitPdiDto } from './dto/mobile-deployment.dto.js';
import { riderPdiWorkflow } from './rider-pdi.js';

const mandatory = { code: 'BRAKES', label: 'Brakes', mandatory: true };
const optional = { code: 'ACCESSORY', label: 'Accessory', mandatory: false };
function fixture(checklist: unknown = [mandatory, optional], training = true) {
  const workflow = { id: 'workflow', status: 'PDI_PENDING_RIDER', pdiChecklist: checklist };
  const update = vi.fn().mockImplementation(({ data }) => ({ ...workflow, ...data }));
  const tx = {
    $queryRaw: vi.fn(),
    allocation: { findFirst: vi.fn().mockResolvedValue({ fleetId: 'fleet', status: 'OTP_PENDING' }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    fleet: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    mobileDeploymentWorkflow: { update },
  };
  const prisma = {
    rider: { findFirst: vi.fn().mockResolvedValue({ id: 'rider' }) },
    allocation: { findFirst: vi.fn().mockResolvedValue({ id: 'allocation' }) },
    mobileDeploymentWorkflow: { upsert: vi.fn().mockResolvedValue(workflow), update },
    clientSubscription: { findFirst: vi.fn().mockResolvedValue({ package: { features: training ? [{ feature: { trainingContents: [] } }] : [] } }) },
    photo: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn().mockImplementation(fn => fn(tx)),
  };
  const media = { createUploadIntent: vi.fn().mockResolvedValue({}), complete: vi.fn().mockResolvedValue({}) };
  const service = new MobileDeploymentService(prisma as never, {} as never, media as never, {} as never, { activateInTransaction: vi.fn() } as never);
  // This test focuses on checklist handling; evidence and ownership have their own integration coverage.
  const evidence = vi.spyOn(service as unknown as { allocationEvidence: (...args: string[]) => Promise<unknown> }, 'allocationEvidence').mockResolvedValue({ inspection: { id: 'inspection' }, missingPhotoTypes: [] });
  return { service, prisma, workflow, tx, media, evidence };
}

describe('optional PDI checks', () => {
  it('filters Rider views without modifying the full Fleet Manager checklist', () => {
    const workflow = { pdiChecklist: [mandatory, optional] };
    expect(riderPdiWorkflow(workflow).pdiChecklist).toEqual([mandatory]);
    expect(workflow.pdiChecklist).toEqual([mandatory, optional]);
    expect(riderPdiWorkflow({ pdiChecklist: [{ code: 'LEGACY' }] }).pdiChecklist).toEqual([{ code: 'LEGACY' }]);
  });
  it('requires only mandatory acknowledgement and preserves the saved checklist', async () => {
    const { service, prisma, workflow } = fixture();
    const items = [{ code: 'BRAKES', accepted: true }];
    expect(await service.acceptPdi('client', 'user', 'allocation', items)).toMatchObject({ status: 'TRAINING_PENDING', pdiChecklist: [mandatory] });
    expect(prisma.mobileDeploymentWorkflow.update.mock.calls[0][0].data).toMatchObject({ riderPdiRemarksText: JSON.stringify(items) });
    expect(prisma.mobileDeploymentWorkflow.update.mock.calls[0][0].data).not.toHaveProperty('pdiChecklist');
    expect(workflow.pdiChecklist).toEqual([mandatory, optional]);
  });
  it.each([true, false])('allows an all-optional checklist without acknowledgements, training included: %s', async training => {
    const { service, workflow } = fixture([optional], training);
    expect(await service.acceptPdi('client', 'user', 'allocation', [])).toMatchObject({ status: training ? 'TRAINING_PENDING' : 'DEPLOYED', pdiChecklist: [] });
    expect(workflow.pdiChecklist).toEqual([optional]);
  });
  it.each([null, []])('keeps missing or empty Fleet Manager checklists blocked: %j', async checklist => {
    await expect(fixture(checklist).service.acceptPdi('client', 'user', 'allocation', [])).rejects.toThrow('PDI checklist is unavailable');
  });
  it('does not waive mandatory acknowledgements or remarks on rejection', async () => {
    const { service, prisma } = fixture();
    await expect(service.acceptPdi('client', 'user', 'allocation', [])).rejects.toThrow('not been acknowledged');
    await expect(service.acceptPdi('client', 'user', 'allocation', [{ code: 'BRAKES', accepted: false, remarksText: ' ' }])).rejects.toThrow('text or voice remark');
    expect(prisma.mobileDeploymentWorkflow.update).not.toHaveBeenCalled();
  });
  it.each(['ACCESSORY', 'UNKNOWN'])('rejects acknowledgement for hidden or unknown code %s', async code => {
    await expect(fixture().service.acceptPdi('client', 'user', 'allocation', [{ code: 'BRAKES', accepted: true }, { code, accepted: true }])).rejects.toThrow('Only mandatory PDI items');
  });
  it('rejects duplicate acknowledgements', async () => {
    await expect(fixture().service.acceptPdi('client', 'user', 'allocation', [{ code: 'BRAKES', accepted: true }, { code: 'BRAKES', accepted: true }])).rejects.toThrow('one acknowledgement');
  });
  it.each(['ACCESSORY', 'UNKNOWN'])('does not create voice uploads for code %s', async code => {
    const { service, media, evidence } = fixture();
    await expect(service.createPdiVoiceUploadIntent('client', 'user', 'allocation', { itemCode: code, mimeType: 'audio/mpeg', fileName: 'remark.mp3', sizeBytes: 10 })).rejects.toThrow('mandatory PDI items');
    expect(media.createUploadIntent).not.toHaveBeenCalled();
    expect(evidence).not.toHaveBeenCalled();
  });
  it('accepts voice remarks only for the matching item in the current inspection', async () => {
    const { service, prisma } = fixture();
    const items = [{ code: 'BRAKES', accepted: false, voiceMediaId: 'voice' }];
    prisma.photo.findMany.mockResolvedValueOnce([{ id: 'voice', photoType: 'PDI_VOICE_ACCESSORY' }] as never);
    await expect(service.acceptPdi('client', 'user', 'allocation', items)).rejects.toThrow('for its mandatory item');
    prisma.photo.findMany.mockResolvedValueOnce([{ id: 'voice', photoType: 'PDI_VOICE_BRAKES' }] as never);
    await expect(service.acceptPdi('client', 'user', 'allocation', items)).resolves.toMatchObject({ status: 'TRAINING_PENDING' });
    expect(prisma.photo.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ clientId: 'client', entityId: 'inspection', status: 'COMPLETE' }) }));
  });
  it('blocks completing a voice upload for a hidden item', async () => {
    const { service, prisma, media } = fixture();
    prisma.photo.findFirst.mockResolvedValueOnce({ id: 'voice', photoType: 'PDI_VOICE_ACCESSORY' } as never);
    await expect(service.completePdiVoiceUpload('client', 'user', 'allocation', 'voice')).rejects.toThrow('mandatory checklist item');
    expect(media.complete).not.toHaveBeenCalled();
  });
  it('rejects duplicate Fleet Manager item codes before saving PDI', async () => {
    const pipe = new ValidationPipe({ transform: true });
    await expect(pipe.transform({ workPartnerName: 'Partner', checklist: [mandatory, { ...optional, code: mandatory.code }] }, { type: 'body', metatype: SubmitPdiDto })).rejects.toThrow();
  });
});
