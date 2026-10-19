export type LegalSeedDocument = {
  clientCode: string;
  appCode: string;
  role: string;
  kind: string;
  locale: string;
  version: string;
  title: string;
  content: string;
  acceptance?: Record<string, string>;
  contentHash: string;
  effectiveAt: string;
  publishedAt: string | null;
  retiredAt: string | null;
  deletedAt: string | null;
  createdAt: string;
};

export const legalDocumentCatalog: LegalSeedDocument[];
export function seedLegal(prisma: unknown): Promise<void>;
