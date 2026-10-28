import { describe, expect, it } from 'vitest';
import {
  dynadotRetryAfter,
  inspectDynadotRateLimit,
  encodeDynadotRateLimit,
  readDynadotRateLimit,
} from './dynadot-rate-limit';
const bytes = (value: string) => new TextEncoder().encode(value);
describe('safe Dynadot 429 diagnostics', () => {
  it.each([
    [
      'You have reached the maximum allowed requests within the concurrent limit of your account.',
      'concurrency',
    ],
    [
      'Daily quota for the command has been reached. Please try again tomorrow.',
      'daily_quota',
    ],
    [
      'Too many requests. Rate limit exceeded. Please try again after 60 seconds.',
      'request_rate',
    ],
    ['PRIVATE_KEY customer.example', 'unknown'],
  ])(
    'classifies without retaining response description: %s',
    (description, reason) => {
      const d = inspectDynadotRateLimit(
        'https://api.dynadot.com/restful/v2/domains?key=PRIVATE_KEY',
        new Headers({
          'Retry-After': '180',
          'X-Request-ID': '3bf56232-7150-4ad1-8d45-ef7533e0d024',
          'CF-Ray': '1234567890abcdef-SIN',
        }),
        bytes(JSON.stringify({ code: 429, error: { description } })),
      );
      expect(d).toMatchObject({
        reason,
        endpoint: 'inventory',
        format: 'json',
        retryAfterSeconds: 180,
        retryAfterSource: 'seconds',
      });
      expect(JSON.stringify(d)).not.toMatch(
        /PRIVATE_KEY|customer\.example|https|description/,
      );
      expect(
        readDynadotRateLimit(
          new Error('HTTP 429 ' + encodeDynadotRateLimit(d)),
        ),
      ).toEqual(d);
    },
  );
  it('distinguishes edge HTML and discards arbitrary correlation headers', () => {
    const d = inspectDynadotRateLimit(
      'https://api.dynadot.com/restful/v2/domains/customer.example',
      new Headers({
        'X-Request-ID': 'PRIVATE_KEY',
        'CF-Ray': 'email@example.test',
      }),
      bytes('<html>Cloudflare cf-chl-challenge PRIVATE_KEY</html>'),
    );
    expect(d).toMatchObject({
      reason: 'edge_challenge',
      format: 'html',
      endpoint: 'other',
      retryAfterSource: 'fallback',
    });
    expect(d.requestId).toBeUndefined();
    expect(d.edgeRequestId).toBeUndefined();
    expect(JSON.stringify(d)).not.toMatch(/PRIVATE_KEY|example/);
  });
  it('does not accept invalid or oversized diagnostic markers', () => {
    expect(
      readDynadotRateLimit(new Error('[dynadot429:{"reason":"PRIVATE_KEY"}]')),
    ).toBeUndefined();
    expect(
      readDynadotRateLimit(new Error('[dynadot429:' + 'x'.repeat(500) + ']')),
    ).toBeUndefined();
  });
});

it('keeps malformed and out-of-range retry headers bounded', () => {
  expect(dynadotRetryAfter('1e100')).toEqual({
    seconds: 60,
    source: 'fallback',
  });
  expect(dynadotRetryAfter('1.5')).toEqual({ seconds: 2, source: 'seconds' });
});
