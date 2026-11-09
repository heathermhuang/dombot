import type { MarketConfigField, MarketId } from './markets';
export const AFTERNIC_CONFIG_FIELDS: MarketConfigField[] = [
  { name: 'apiKey', label: 'API Key', type: 'password', required: true },
  { name: 'apiSecret', label: 'API Secret', type: 'password', required: true },
];
export const ATOM_CONFIG_FIELDS: MarketConfigField[] = [
  { name: 'apiToken', label: 'API Token', type: 'password', required: true },
  { name: 'userId', label: 'User ID', type: 'text', required: true },
];
export const SEDO_CONFIG_FIELDS: MarketConfigField[] = [
  { name: 'partnerId', label: 'Partner ID', type: 'text', required: true },
  { name: 'signKey', label: 'Sign Key', type: 'password', required: true },
  { name: 'username', label: 'Sedo Username', type: 'text', required: true },
  {
    name: 'password',
    label: 'Sedo Password',
    type: 'password',
    required: true,
  },
];
export const MARKET_CREDENTIAL_FIELDS: Partial<
  Record<MarketId, MarketConfigField[]>
> = {
  afternic: AFTERNIC_CONFIG_FIELDS,
  atom: ATOM_CONFIG_FIELDS,
  sedo: SEDO_CONFIG_FIELDS,
};
