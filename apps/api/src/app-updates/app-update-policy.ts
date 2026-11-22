import { BadRequestException } from '@nestjs/common';
import type {
  AppIdentityDto,
  AppPolicySettingsDto,
  AppReleaseDto,
} from './app-update.dto.js';

export function compareRelease(
  a: AppReleaseDto,
  b: AppReleaseDto,
  platform: AppIdentityDto['platform'],
): number {
  if (platform === 'ANDROID')
    return Math.sign(Number(a.build) - Number(b.build));
  for (const key of ['version', 'build'] as const) {
    const left = a[key].split('.').map(Number),
      right = b[key].split('.').map(Number);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      const difference = (left[i] ?? 0) - (right[i] ?? 0);
      if (difference) return Math.sign(difference);
    }
  }
  return 0;
}
export function validateRelease(
  platform: AppIdentityDto['platform'],
  release: AppReleaseDto,
) {
  if (
    platform === 'ANDROID' &&
    (!/^[1-9]\d{0,9}$/.test(release.build) ||
      Number(release.build) > 2100000000)
  )
    throw new BadRequestException(
      'Android build must be a positive integer no greater than 2100000000.',
    );
  if (
    platform === 'IOS' &&
    !release.build.split('.').some((part) => Number(part) > 0)
  )
    throw new BadRequestException('iOS build must be greater than zero.');
}
export function validateSettings(
  identity: AppIdentityDto,
  settings: AppPolicySettingsDto,
) {
  validateRelease(identity.platform, settings.minimum);
  validateRelease(identity.platform, settings.latest);
  if (compareRelease(settings.minimum, settings.latest, identity.platform) > 0)
    throw new BadRequestException(
      'Minimum release must not exceed latest release.',
    );
  if (!settings.title.trim() || !settings.message.trim())
    throw new BadRequestException(
      'Update title and message must not be blank.',
    );
  let url: URL;
  try {
    url = new URL(settings.storeUrl);
  } catch {
    throw new BadRequestException('A valid store URL is required.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  )
    throw new BadRequestException(
      'Use a secure store URL without credentials, port, or fragment.',
    );
  const valid =
    identity.platform === 'ANDROID'
      ? url.hostname === 'play.google.com' &&
        url.pathname === '/store/apps/details' &&
        url.searchParams.getAll('id').length === 1 &&
        url.searchParams.get('id') === identity.applicationId
      : url.hostname === 'apps.apple.com' &&
        /\/id[1-9]\d*\/?$/.test(url.pathname);
  if (!valid)
    throw new BadRequestException(
      identity.platform === 'ANDROID'
        ? 'Use the Google Play URL for this application ID.'
        : 'Use an Apple App Store URL ending in its numeric app ID.',
    );
}
export function evaluatePolicy(
  settings: AppPolicySettingsDto | null,
  installed: AppReleaseDto,
  platform: AppIdentityDto['platform'],
) {
  const decision = !settings?.enabled
    ? 'allowed'
    : compareRelease(installed, settings.minimum, platform) < 0
      ? 'required_update'
      : compareRelease(installed, settings.latest, platform) < 0
        ? 'optional_update'
        : 'allowed';
  return {
    decision,
    minimum: settings?.enabled ? settings.minimum : null,
    latest: settings?.enabled ? settings.latest : null,
    title: settings?.enabled ? settings.title : null,
    message: settings?.enabled ? settings.message : null,
    releaseNotes: settings?.enabled ? settings.releaseNotes : null,
    storeUrl: settings?.enabled ? settings.storeUrl : null,
    // Offline clients must expire cached restrictions, and recheck on resume.
    cacheMaxAgeSeconds: 300,
  };
}
