import { describe, expect, it } from 'vitest';
import {
  buyerDetailsSchema,
  captureInquiryRequest,
  inquiryBrowser,
} from './inquiry-identity';
import { inquirySchema } from './hosted-sales';
import {
  signGatewayRequest,
  verifyGatewayRequest,
  PROOF_HEADER,
} from './gateway-proof';

describe('inquiry identity boundaries', () => {
  it('accepts optional professional context but refuses executable and credential-bearing links', () => {
    expect(buyerDetailsSchema.parse({})).toEqual({});
    expect(
      buyerDetailsSchema.parse({
        profileUrl: ' https://www.linkedin.com/in/example ',
        inquiryRole: 'organization',
      }).profileUrl,
    ).toBe('https://www.linkedin.com/in/example');
    for (const profileUrl of [
      'javascript:alert(1)',
      'data:text/html,test',
      'https://user:password@example.com',
      'not a url',
    ])
      expect(buyerDetailsSchema.safeParse({ profileUrl }).success).toBe(false);
    expect(
      buyerDetailsSchema.safeParse({ company: 'x'.repeat(151) }).success,
    ).toBe(false);
    expect(
      buyerDetailsSchema.safeParse({ inquiryRole: 'arbitrary' }).success,
    ).toBe(false);
    expect(
      inquirySchema.safeParse({
        observedRevision: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        name: 'Example',
        email: 'example@example.com',
        offer: null,
        message: 'Inquiry',
        website: '',
        turnstileToken: '',
        requestMetadata: { ipAddress: 'forged' },
      }).success,
    ).toBe(false);
  });
  it('captures bounded external request context without arbitrary headers or URL secrets', () => {
    const request = new Request(
      'https://example.test/96.ai/inquiries?secret=never-store',
      {
        headers: {
          'cf-connecting-ip': '203.0.113.4',
          'user-agent': 'a'.repeat(2000),
          'accept-language': 'en-SG',
          authorization: 'SECRET',
          cookie: 'SECRET',
          'x-forwarded-for': 'FORGED',
        },
      },
    );
    Object.defineProperty(request, 'cf', {
      value: {
        country: 'SG',
        city: 'Singapore',
        region: 'Central',
        timezone: 'Asia/Singapore',
        latitude: 'never-store',
      },
    });
    const captured = captureInquiryRequest(request);
    expect(captured).toMatchObject({
      ipAddress: '203.0.113.4',
      country: 'SG',
      city: 'Singapore',
      timezone: 'Asia/Singapore',
      language: 'en-SG',
    });
    expect(captured.userAgent).toHaveLength(1024);
    expect(JSON.stringify(captured)).not.toMatch(/SECRET|FORGED|never-store/);
    expect(
      captureInquiryRequest(new Request('https://example.test')).country,
    ).toBeNull();
  });
  it('binds original metadata to the signed request instead of trusting internal-hop headers', async () => {
    const secret = 'synthetic-inquiry-proof-key-'.repeat(3),
      workspace = crypto.randomUUID();
    const original = new Request('https://example.test/96.ai/inquiries', {
      method: 'POST',
      body: 'same body',
      headers: {
        'cf-connecting-ip': '203.0.113.8',
        'user-agent': 'Original reported browser',
      },
    });
    const metadata = captureInquiryRequest(original);
    const forwarded = new Request('https://example.test/d/96.ai/inquiries', {
      method: 'POST',
      body: 'same body',
      headers: {
        'cf-connecting-ip': '192.0.2.90',
        'user-agent': 'Internal hop',
      },
    });
    forwarded.headers.set(
      PROOF_HEADER,
      await signGatewayRequest(secret, workspace, null, forwarded, {
        purpose: 'sales-public',
        host: 'example.test',
        listing: null,
        epoch: 0,
        inquiryRequest: metadata,
      }),
    );
    const proof = await verifyGatewayRequest(secret, workspace, forwarded);
    expect(
      proof?.sales?.purpose === 'sales-public' && proof.sales.inquiryRequest,
    ).toEqual(metadata);
    const changed = new Request(forwarded.url, {
      method: 'POST',
      body: 'different body',
      headers: forwarded.headers,
    });
    expect(await verifyGatewayRequest(secret, workspace, changed)).toBeNull();
  });
  it('describes reported browser context without inferring personal identity', () => {
    expect(inquiryBrowser(null)).toBe('Not available');
    expect(
      inquiryBrowser('Mozilla/5.0 (Macintosh) Chrome/142 Safari/537'),
    ).toBe('Chrome · macOS');
    expect(
      inquiryBrowser('Mozilla/5.0 (Windows) Chrome/142 Safari/537 Edg/142'),
    ).toBe('Edge · Windows');
  });
});
