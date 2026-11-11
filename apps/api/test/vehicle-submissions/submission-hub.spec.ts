import { afterEach, describe, expect, it, vi } from 'vitest';
import { plannedDate, selectSubmissionHub } from '../../src/vehicle-submissions/submission-hub.js';
const hubs = [
  { id: 'far', name: 'Far', latitude: 17, longitude: 78 },
  { id: 'near', name: 'Near', latitude: 18, longitude: 79 },
];
function fixture() {
  const db = {
    hub: { findMany: vi.fn().mockResolvedValue(hubs) },
    fleet: { findFirst: vi.fn().mockResolvedValue({ currentHubId: 'far' }) },
    vehicleCurrentState: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  return db;
}
describe('submission hub and schedule', () => {
  afterEach(() => vi.useRealTimers());
  it('chooses the nearest eligible hub from rider coordinates, then vehicle coordinates, then the current hub', async () => {
    const db = fixture();
    expect(
      (
        await selectSubmissionHub(db as never, 'client', 'fleet', undefined, {
          latitude: 18.01,
          longitude: 79.01,
        })
      ).hub.id,
    ).toBe('near');
    expect(db.vehicleCurrentState.findFirst).not.toHaveBeenCalled();
    db.vehicleCurrentState.findFirst.mockResolvedValue({
      latitude: 18,
      longitude: 79,
    } as never);
    expect(
      (await selectSubmissionHub(db as never, 'client', 'fleet')).selection,
    ).toBe('VEHICLE_LOCATION');
    db.vehicleCurrentState.findFirst.mockResolvedValue(null);
    expect(
      (await selectSubmissionHub(db as never, 'client', 'fleet')).hub.id,
    ).toBe('far');
    expect(
      (await selectSubmissionHub(db as never, 'client', 'fleet', 'near'))
        .selection,
    ).toBe('SELECTED');
    expect(db.hub.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          clientId: 'client',
          status: 'ACTIVE',
          deletedAt: null,
          supportsDeallocation: true,
        },
      }),
    );
  });
  it('rejects unavailable hubs and incomplete coordinates', async () => {
    const db = fixture();
    await expect(
      selectSubmissionHub(db as never, 'client', 'fleet', 'other-client-hub'),
    ).rejects.toThrow('unavailable');
    await expect(
      selectSubmissionHub(db as never, 'client', 'fleet', undefined, {
        latitude: 18,
      }),
    ).rejects.toThrow('together');
    await expect(
      selectSubmissionHub(db as never, 'client', 'fleet', undefined, {
        latitude: 91,
        longitude: 0,
      }),
    ).rejects.toThrow('together');
    db.hub.findMany.mockResolvedValue([]);
    await expect(
      selectSubmissionHub(db as never, 'client', 'fleet'),
    ).rejects.toThrow('No active');
  });
  it('accepts today in India and future dates, rejects invalid or past dates, and permits historical retry parsing', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T23:00:00Z'));
    expect(plannedDate('2026-10-16').toISOString()).toBe(
      '2026-10-16T00:00:00.000Z',
    );
    expect(() => plannedDate('2026-10-15')).toThrow('past');
    expect(() => plannedDate('2026-02-30')).toThrow('Invalid');
    expect(() => plannedDate(undefined)).toThrow('valid');
    expect(plannedDate('2026-10-15', true)).toBeInstanceOf(Date);
  });
});
