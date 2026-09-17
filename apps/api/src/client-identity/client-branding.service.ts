import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../media/storage/storage-provider.interface.js';
import type {
  BrandingUploadDto,
  CompleteBrandingUploadDto,
  PublicClientContext,
  UpdateBrandingDto,
} from './branding.dto.js';
export const DEFAULT_BRANDING: PublicClientContext['branding'] = {
  logoUrl: null,
  faviconUrl: null,
  primaryColor: '#176b4c',
  secondaryColor: '#e4f2e9',
  accentColor: '#27865f',
  loginTitle: 'Welcome back',
  loginSubtitle: 'Sign in to your EV fleet workspace.',
  supportEmail: null,
  supportPhone: null,
};
@Injectable()
export class ClientBrandingService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly audit: AuditService,
  ) {}
  async context(clientId?: string): Promise<PublicClientContext> {
    if (!clientId) return { client: null, branding: { ...DEFAULT_BRANDING } };
    const client = await this.prisma.client.findFirst({
      where: {
        id: clientId,
        isActive: true,
        status: { notIn: ['DRAFT', 'SUSPENDED'] },
      },
      select: {
        name: true,
        branding: true,
        businessProfile: { select: { logoObjectKey: true } },
      },
    });
    if (!client) throw new NotFoundException('Workspace unavailable.');
    const b = client.branding;
    const logoKey = b?.logoObjectKey ?? client.businessProfile?.logoObjectKey;
    return {
      client: { displayName: client.name },
      branding: {
        logoUrl: logoKey ? await this.storage.createDownloadUrl(logoKey) : null,
        faviconUrl: b?.faviconObjectKey
          ? await this.storage.createDownloadUrl(b.faviconObjectKey)
          : null,
        primaryColor: b?.primaryColor ?? DEFAULT_BRANDING.primaryColor,
        secondaryColor: b?.secondaryColor ?? DEFAULT_BRANDING.secondaryColor,
        accentColor: b?.accentColor ?? DEFAULT_BRANDING.accentColor,
        loginTitle: b?.loginTitle ?? DEFAULT_BRANDING.loginTitle,
        loginSubtitle: b?.loginSubtitle ?? DEFAULT_BRANDING.loginSubtitle,
        supportEmail: b?.supportEmail ?? null,
        supportPhone: b?.supportPhone ?? null,
      },
    };
  }
  async update(clientId: string, dto: UpdateBrandingDto, actorId: string) {
    await this.prisma.clientBranding.upsert({
      where: { clientId },
      create: { clientId, ...dto },
      update: dto,
    });
    await this.audit.record({
      clientId,
      actorId,
      action: 'CLIENT_BRANDING_UPDATED',
      entityType: 'Client',
      entityId: clientId,
    });
    return this.context(clientId);
  }
  async upload(clientId: string, dto: BrandingUploadDto) {
    const extension = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
    }[dto.mimeType];
    if (!extension || !['logo', 'favicon'].includes(dto.kind))
      throw new BadRequestException('Unsupported branding image.');
    const objectKey = `clients/${clientId}/branding/${dto.kind}/${randomUUID()}.${extension}`;
    return {
      objectKey,
      uploadUrl: await this.storage.createUploadUrl({
        objectKey,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
      }),
    };
  }
  async complete(
    clientId: string,
    dto: CompleteBrandingUploadDto,
    actorId: string,
  ) {
    const prefix = `clients/${clientId}/branding/${dto.kind}/`;
    if (
      !dto.objectKey.startsWith(prefix) ||
      !/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(
        dto.objectKey.slice(prefix.length),
      )
    )
      throw new BadRequestException('Invalid branding object.');
    await this.storage.assertObjectExists(dto.objectKey, { maxBytes: 2 * 1024 * 1024 });
    const update =
      dto.kind === 'logo'
        ? { logoObjectKey: dto.objectKey }
        : { faviconObjectKey: dto.objectKey };
    await this.prisma.clientBranding.upsert({
      where: { clientId },
      create: { clientId, ...update },
      update,
    });
    await this.audit.record({
      clientId,
      actorId,
      action: 'CLIENT_BRANDING_IMAGE_UPDATED',
      entityType: 'Client',
      entityId: clientId,
      newData: { kind: dto.kind },
    });
    return this.context(clientId);
  }
}
