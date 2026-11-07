import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error The .mjs seed is executed directly by Node and does not ship TypeScript declarations.
import {
  seedYogmayaCommercialTerms,
  yogmayaCommercialTerms,
} from '../../prisma/client/yogmaya/commercial-terms.mjs';

type TermsRow = Record<string, unknown>;

function fakePrisma({
  existing = null as TermsRow | null,
  actor = { id: 'admin-id' } as TermsRow | null,
} = {}) {
  const creates: TermsRow[] = [];
  let stored = existing;
  const prisma = {
    client: {
      findUnique: vi.fn().mockResolvedValue({ id: 'yogmaya-id' }),
    },
    user: {
      findFirst: vi.fn().mockResolvedValue(actor),
    },
    riderCommercialTerms: {
      findFirst: vi.fn(async () => stored),
      create: vi.fn(async ({ data }: { data: TermsRow }) => {
        creates.push(data);
        stored = data;
        return data;
      }),
    },
  };
  return { prisma, creates };
}

describe('Yogmaya commercial terms seed', () => {
  beforeEach(() => vi.stubEnv('NODE_ENV', 'development'));
  afterEach(() => vi.unstubAllEnvs());

  it('is wired into the consolidated Yogmaya seed after legal documents', async () => {
    const source = await readFile(
      new URL('../../prisma/seed-yogmaya.mjs', import.meta.url),
      'utf8',
    );
    expect(source).toContain(
      "import { seedYogmayaCommercialTerms } from './client/yogmaya/commercial-terms.mjs';",
    );
    expect(source.indexOf('await seedLegal(prisma);')).toBeLessThan(
      source.indexOf('await seedYogmayaCommercialTerms(prisma);'),
    );
  });

  it('creates one active rental terms version when none exists', async () => {
    const { prisma, creates } = fakePrisma();

    const result = await seedYogmayaCommercialTerms(prisma);

    expect(result).toMatchObject({
      clientId: 'yogmaya-id',
      code: yogmayaCommercialTerms.code,
      version: 1,
      status: 'ACTIVE',
      title: 'STAGING TEST ONLY — Yogmaya rental terms',
      contentHash: yogmayaCommercialTerms.contentHash,
      createdById: 'admin-id',
      activatedById: 'admin-id',
    });
    expect(yogmayaCommercialTerms.content).toContain(
      'STAGING TEST ONLY.</strong> This is not a production rental agreement.',
    );
    expect(
      createHash('sha256')
        .update(yogmayaCommercialTerms.content, 'utf8')
        .digest('hex'),
    ).toBe(yogmayaCommercialTerms.contentHash);
    expect(creates).toHaveLength(1);
    expect(creates[0].content).toBe(yogmayaCommercialTerms.content);
    expect(prisma.riderCommercialTerms.findFirst).toHaveBeenCalledWith({
      where: { clientId: 'yogmaya-id' },
    });

    await expect(seedYogmayaCommercialTerms(prisma)).resolves.toEqual(result);
    expect(creates).toHaveLength(1);
  });

  it('preserves any existing administrator-managed terms record', async () => {
    const existing = {
      id: 'admin-terms',
      code: 'CUSTOM_RENTAL',
      version: 7,
      status: 'DRAFT',
    };
    const { prisma, creates } = fakePrisma({ existing });

    await expect(seedYogmayaCommercialTerms(prisma)).resolves.toEqual(existing);

    expect(creates).toHaveLength(0);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('does not write anything in production', async () => {
    const original = process.env.NODE_ENV;
    try {
      for (const environment of ['production', 'staging', 'typo']) {
        vi.stubEnv('NODE_ENV', environment);
        const { prisma, creates } = fakePrisma();
        await expect(seedYogmayaCommercialTerms(prisma)).resolves.toBeNull();
        expect(creates).toHaveLength(0);
        expect(prisma.client.findUnique).not.toHaveBeenCalled();
        expect(prisma.user.findFirst).not.toHaveBeenCalled();
        expect(prisma.riderCommercialTerms.findFirst).not.toHaveBeenCalled();
        expect(prisma.riderCommercialTerms.create).not.toHaveBeenCalled();
      }

      delete process.env.NODE_ENV;
      const { prisma, creates } = fakePrisma();
      await expect(seedYogmayaCommercialTerms(prisma)).resolves.toBeNull();
      expect(creates).toHaveLength(0);
      expect(prisma.client.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(prisma.riderCommercialTerms.findFirst).not.toHaveBeenCalled();
      expect(prisma.riderCommercialTerms.create).not.toHaveBeenCalled();
    } finally {
      if (original === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original;
    }
  });
});
