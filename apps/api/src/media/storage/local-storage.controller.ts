import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard.js';
import {
  LocalStorageProvider,
  type LocalDownload,
} from './local-storage.provider.js';

@Controller('storage/local')
@UseGuards(AccessTokenGuard)
export class LocalStorageController {
  constructor(private readonly storage: LocalStorageProvider) {}

  @Put('upload')
  @HttpCode(HttpStatus.NO_CONTENT)
  async upload(
    @Headers('x-upload-token') token: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: Buffer,
  ): Promise<void> {
    if (!contentType) {
      throw new BadRequestException('Content-Type is required.');
    }
    await this.storage.consumeUpload(
      token ?? '',
      contentType.split(';', 1)[0].trim().toLowerCase(),
      body,
    );
  }

  @Get('download')
  async download(
    @Headers('x-download-token') token: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<FastifyReply> {
    const download = await this.storage.openDownload(token ?? '');
    reply
      .header('Content-Type', download.mimeType)
      .header('Content-Length', download.sizeBytes)
      .header(
        'Content-Disposition',
        `attachment; filename="${downloadName(download)}"`,
      )
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store');
    return reply.send(download.stream);
  }
}

function downloadName(download: LocalDownload): string {
  if (download.mimeType === 'application/pdf') return 'download.pdf';
  if (download.mimeType === 'image/jpeg') return 'download.jpg';
  if (download.mimeType === 'image/png') return 'download.png';
  if (download.mimeType === 'image/webp') return 'download.webp';
  return 'download.bin';
}
