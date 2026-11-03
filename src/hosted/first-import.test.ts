import { expect, it } from 'vitest';
import { validFirstImport } from './first-import';
const submission = (rows: unknown[]) => ({
  args: [rows, { importId: 'stable-import-attempt' }],
});
it('accepts normalized private import data, including valid metadata', () => {
  expect(
    validFirstImport(
      submission([
        {
          line: 1,
          domain: 'working.io',
          registration: { registrar: 'dynadot', expirationDate: '2027-02-28' },
          renewal: { amount: '12.50', currency: 'USD' },
          listPrice: { amount: '2500', currency: 'USD' },
        },
      ]),
    ),
  ).toBe(true);
});
it.each(
  [
    [],
    [{ line: 1, domain: '' }],
    [{ line: 1, domain: 'not a domain' }],
    [{ line: 1, domain: 'working.io/private' }],
    [{ line: 1, domain: 'www.working.io' }],
    [
      {
        line: 1,
        domain: 'working.io',
        registration: { expirationDate: '2026-02-30' },
      },
    ],
    [
      {
        line: 1,
        domain: 'working.io',
        renewal: { amount: '-1', currency: 'USD' },
      },
    ],
    [
      {
        line: 1,
        domain: 'working.io',
        renewal: { amount: '1.001', currency: 'USD' },
      },
    ],
    [
      {
        line: 1,
        domain: 'working.io',
        renewal: { amount: '5', currency: 'XYZ' },
      },
    ],
    [
      {
        line: 1,
        domain: 'working.io',
        listPrice: { amount: '5.50', currency: 'USD' },
      },
    ],
    [
      {
        line: 1,
        domain: 'working.io',
        listPrice: { amount: '5', minOffer: '10', currency: 'USD' },
      },
    ],
    [
      { line: 1, domain: 'working.io' },
      { line: 2, domain: 'bad row' },
    ],
  ].map((rows) => [rows] as const),
)('rejects invalid content before allocation: %j', (rows) => {
  expect(validFirstImport(submission([...rows]))).toBe(false);
});
it('requires the real import API envelope and bounded rows', () => {
  expect(validFirstImport({ args: [[], { importId: 'id' }] })).toBe(false);
  expect(
    validFirstImport({ args: [[{ line: 1, domain: 'working.io' }]] }),
  ).toBe(false);
  expect(
    validFirstImport(
      submission(
        Array.from({ length: 10001 }, () => ({
          line: 1,
          domain: 'working.io',
        })),
      ),
    ),
  ).toBe(false);
});
