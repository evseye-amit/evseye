import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AssignAllocationTeamLeadDto, TeamLeadQueryDto } from '../../src/allocations/allocation-team-lead.controller.js';

describe('Allocation Team Lead HTTP validation', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  it('requires a Team Lead profile UUID and rejects extra caller-controlled fields', async () => {
    const metadata = { type: 'body' as const, metatype: AssignAllocationTeamLeadDto };
    await expect(pipe.transform({}, metadata)).rejects.toThrow();
    await expect(pipe.transform({ teamLeaderId: 'not-a-uuid' }, metadata)).rejects.toThrow();
    await expect(pipe.transform({ teamLeaderId: '00000000-0000-4000-8000-000000000001', clientId: 'other-client' }, metadata)).rejects.toThrow();
    await expect(pipe.transform({ teamLeaderId: '00000000-0000-4000-8000-000000000001' }, metadata)).resolves.toBeInstanceOf(AssignAllocationTeamLeadDto);
  });
  it('sets bounded pagination defaults and transforms numeric query strings', async () => {
    const metadata = { type: 'query' as const, metatype: TeamLeadQueryDto };
    await expect(pipe.transform({}, metadata)).resolves.toMatchObject({ page: 1, limit: 25 });
    await expect(pipe.transform({ page: '2', limit: '10', search: 'Lead' }, metadata)).resolves.toMatchObject({ page: 2, limit: 10, search: 'Lead' });
    await expect(pipe.transform({ page: '0', limit: '101' }, metadata)).rejects.toThrow();
  });
});
