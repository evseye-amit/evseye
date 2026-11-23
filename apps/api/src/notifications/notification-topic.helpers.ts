import { hash } from './notification.helpers.js';
export function topicName(
  environment: string,
  clientId: string,
  bindingId: string,
  appCode: string,
  logicalKey: string,
) {
  return `evseye_v1_${hash(JSON.stringify([environment, clientId, bindingId, appCode])).slice(0, 32)}_${hash(logicalKey).slice(0, 32)}`;
}
export const topicApplication: Record<string, string> = {
  RIDER_APP: 'RIDER',
  FLEET_MANAGER_APP: 'FLEET_MANAGER',
  TEAM_LEADER_APP: 'TEAM_LEADER',
};
export function audienceTopicKeys(
  role: string,
  dimensions: Array<{
    hubId: string | null;
    city: string | null;
    vehicleTypeId: string | null;
    oemId: string | null;
  }>,
) {
  const keys = new Set(['all_users']);
  if (role !== 'RIDER') keys.add('all_employees');
  if (role === 'FLEET_MANAGER') keys.add('all_fleet_managers');
  if (role === 'TEAM_LEAD') keys.add('all_team_leaders');
  if (role === 'RIDER') {
    keys.add('all_riders');
    for (const row of dimensions) {
      if (row.hubId) keys.add(`all_hub_${row.hubId}_riders`);
      if (row.city?.trim())
        keys.add(`all_city_${row.city.trim().toLowerCase()}_riders`);
      if (row.vehicleTypeId)
        keys.add(`all_vehicle_type_${row.vehicleTypeId}_riders`);
      if (row.oemId) keys.add(`all_oem_${row.oemId}_riders`);
    }
  }
  return [...keys].sort();
}
