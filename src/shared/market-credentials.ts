import type { MarketConfigField, MarketId } from './markets';
export const AFTERNIC_CONFIG_FIELDS: MarketConfigField[] = [
  { name: 'apiKey', label: 'API key', type: 'password', required: true },
  { name: 'apiSecret', label: 'API secret', type: 'password', required: true },
];
export const ATOM_CONFIG_FIELDS: MarketConfigField[] = [
  { name: 'apiToken', label: 'API token', type: 'password', required: true },
  { name: 'userId', label: 'User ID', type: 'text', required: true },
];
export const SEDO_CONFIG_FIELDS: MarketConfigField[] = [
  { name: 'partnerId', label: 'Partner ID', type: 'text', required: true },
  { name: 'signKey', label: 'Sign key', type: 'password', required: true },
  { name: 'username', label: 'Sedo username', type: 'text', required: true },
  {
    name: 'password',
    label: 'Sedo password',
    type: 'password',
    required: true,
  },
];
export const MARKET_CREDENTIAL_FIELDS: Record<MarketId, MarketConfigField[]> = {
  afternic: AFTERNIC_CONFIG_FIELDS,
  atom: ATOM_CONFIG_FIELDS,
  sedo: SEDO_CONFIG_FIELDS,
};
