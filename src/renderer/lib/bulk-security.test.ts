import { describe, expect, it } from 'vitest';
import type { BulkJob } from '../../shared/ipc';
import { parseCsv } from '../../shared/csv';
import { authCodesToTsv, resultsToCsv } from './bulk';
function report(value: string): BulkJob {
  return {
    id: 'controlled-export',
    op: { kind: 'authCode' },
    status: 'done',
    total: 1,
    results: [
      {
        target: { registrar: 'gandi', domainName: 'example.com' },
        status: 'ok',
        message: value,
        data: { authCode: value },
      },
    ],
    counts: {
      ok: 1,
      failed: 0,
      unsupported: 0,
      skipped: 0,
      'rate-limited': 0,
      cancelled: 0,
      unknown: 0,
    },
    startedAt: 1,
    finishedAt: 2,
  };
}
describe('bulk spreadsheet exports', () => {
  it.each(['=1+1', '+1', '-1', '@SUM(1,1)', '\t=1', ' \uFEFF=1', '\r=1'])(
    'guards provider messages and auth codes beginning with %s',
    (value) => {
      const row = parseCsv(resultsToCsv(report(value)))[1];
      expect(row[4]).toBe("'" + value);
      expect(row[5]).toBe("'" + value);
    },
  );
  it.each(['=1+1', '+1', '-1', '@SUM(1,1)', '\t=1', ' \uFEFF=1', '\r=1'])(
    'guards clipboard auth code %s',
    (value) => {
      expect(parseCsv(authCodesToTsv(report(value).results), '\t')).toEqual([
        ['example.com', "'" + value],
      ]);
    },
  );
  it('keeps tabs, quotes and line breaks inside one clipboard cell', () => {
    const value = 'opaque\tvalue\nwith "quotes"';
    expect(parseCsv(authCodesToTsv(report(value).results), '\t')).toEqual([
      ['example.com', value],
    ]);
  });
});
