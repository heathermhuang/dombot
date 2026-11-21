import { describe, it, expect } from 'vitest';
import {
  canRecheckParkioSignIn,
  parkioOrdersPage,
} from '../../hosted/parkio-native-contract';
describe('observed native proof Orders navigation', () => {
  it.each([
    'https://park.io/orders',
    'https://park.io/orders/active',
    'https://park.io/orders/index/active',
    'https://park.io/orders?status=active',
  ])('permits a read-only Orders page %s', (url) => {
    expect(parkioOrdersPage(url)).toBe(url);
  });
  it.each([
    'https://other.test/orders',
    'https://park.io/orders/delete',
    'https://park.io/orders?cancel=1',
    'https://park.io/orders/%61ctive',
    'https://user:secret@park.io/orders',
    'https://park.io/orders#secret',
    'http://park.io/orders',
    'https://park.io/users/login',
  ])('holds unsafe/unqualified navigation %s', (url) => {
    expect(() => parkioOrdersPage(url)).toThrow();
  });
});

describe('Park.io existing-intent recovery', () => {
  it.each([
    'connection_unavailable',
    'command_timed_out',
    'sign_in_outcome_unknown',
    'proof_unavailable',
  ])('allows a status check after %s', (code) =>
    expect(canRecheckParkioSignIn(new Error(code))).toBe(true),
  );
  it.each([
    'account_mismatch',
    'daily_browser_budget',
    'cleanup_required',
    'provider_contract_required',
    'session_changed',
  ])('preserves the action required for %s', (code) =>
    expect(canRecheckParkioSignIn(new Error(code))).toBe(false),
  );
});
