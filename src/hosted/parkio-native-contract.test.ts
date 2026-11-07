import { describe, it, expect } from 'vitest';
import { parkioOrdersPage } from '../../hosted/parkio-native-contract';
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
