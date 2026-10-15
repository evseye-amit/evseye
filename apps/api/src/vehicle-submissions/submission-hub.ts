import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';

export type SubmissionLocation = { latitude?: number; longitude?: number };
export function plannedDate(value: string | undefined, allowPast = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value))
    throw new BadRequestException('Select a valid submission date.');
  const date = new Date(value);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value.slice(0, 10)
  )
    throw new BadRequestException('Invalid submission date.');
  const today = new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata',
  });
  if (!allowPast && value.slice(0, 10) < today)
    throw new BadRequestException('Submission date cannot be in the past.');
  return date;
}
export async function selectSubmissionHub(
  db: PrismaService,
  clientId: string,
  fleetId: string,
  selectedId?: string,
  location: SubmissionLocation = {},
) {
  if (
    (location.latitude === undefined) !== (location.longitude === undefined) ||
    (location.latitude !== undefined &&
      (!Number.isFinite(location.latitude) ||
        Math.abs(location.latitude) > 90 ||
        !Number.isFinite(location.longitude) ||
        Math.abs(location.longitude!) > 180))
  )
    throw new BadRequestException(
      'Provide valid latitude and longitude together.',
    );
  const hubs = await db.hub.findMany({
    where: {
      clientId,
      status: 'ACTIVE',
      deletedAt: null,
      supportsDeallocation: true,
    },
    select: {
      id: true,
      code: true,
      name: true,
      city: true,
      latitude: true,
      longitude: true,
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
  if (!hubs.length)
    throw new NotFoundException('No active submission hub is available.');
  if (selectedId) {
    const selected = hubs.find((hub) => hub.id === selectedId);
    if (!selected)
      throw new NotFoundException('Selected submission hub is unavailable.');
    return { hub: selected, selection: 'SELECTED', hubs };
  }
  const fleet = await db.fleet.findFirst({
    where: { id: fleetId, clientId },
    select: { currentHubId: true },
  });
  const state =
    location.latitude === undefined
      ? await db.vehicleCurrentState.findFirst({
          where: { clientId, fleetId },
          select: { latitude: true, longitude: true },
        })
      : null;
  const latitude =
    location.latitude ??
    (state?.latitude == null ? undefined : Number(state.latitude));
  const longitude =
    location.longitude ??
    (state?.longitude == null ? undefined : Number(state.longitude));
  if (latitude !== undefined && longitude !== undefined) {
    const rad = (value: number) => (value * Math.PI) / 180;
    const ranked = hubs
      .filter((hub) => hub.latitude != null && hub.longitude != null)
      .map((hub) => {
        const a =
          Math.sin(rad(Number(hub.latitude) - latitude) / 2) ** 2 +
          Math.cos(rad(latitude)) *
            Math.cos(rad(Number(hub.latitude))) *
            Math.sin(rad(Number(hub.longitude) - longitude) / 2) ** 2;
        return {
          hub,
          distance: 2 * 6371000 * Math.asin(Math.sqrt(Math.min(1, a))),
        };
      })
      .sort((a, b) => a.distance - b.distance);
    if (ranked.length)
      return {
        hub: ranked[0]!.hub,
        selection:
          location.latitude === undefined
            ? 'VEHICLE_LOCATION'
            : 'RIDER_LOCATION',
        hubs,
      };
  }
  return {
    hub: hubs.find((hub) => hub.id === fleet?.currentHubId) ?? hubs[0]!,
    selection: hubs.some((hub) => hub.id === fleet?.currentHubId)
      ? 'CURRENT_HUB'
      : 'AVAILABLE_HUB',
    hubs,
  };
}
