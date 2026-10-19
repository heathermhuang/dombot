import { describe, it, expect } from 'vitest';
import {
  renderSalesEmail,
  salesEmailContextSchema,
  type SalesEmailContext,
} from './sales-email';
import { renderSalesLander } from './render-sales-lander';

const context: SalesEmailContext = {
  name: 'Sample <Buyer>',
  email: 'buyer@example.com',
  message: 'Can we discuss this domain?\nMy budget is flexible.',
  offer: { amount: '2500', currency: 'USD' },
  receivedAt: 1792382400000,
  snapshot: {
    version: 1,
    id: '11111111-1111-4111-8111-111111111111',
    domain: 'sample.example',
    displayName: 'sample.example',
    mode: 'inquiry',
    description: 'Sample data',
    categories: [],
    publicPrice: null,
    publicMinimumOffer: null,
    destination: null,
    allowQuestions: true,
    sellerDisplayName: 'Sample owner',
    revision: '22222222-2222-4222-8222-222222222222',
    publishedAt: 1792382400000,
  },
  latest: {
    body: 'Yes, tell me more. <script>alert(1)</script>',
    direction: 'reply',
    createdAt: 1792382401000,
  },
};
describe('inquiry email experience', () => {
  it('includes full inquiry details and the relevant message in HTML and plain text', () => {
    const mail = renderSalesEmail(
      {
        subject: 'Old subject',
        url: 'https://accounts.example/t/sample',
        reference: 'sample-reference',
        context,
      },
      'buyer-reply',
    );
    for (const content of [mail.html, mail.text]) {
      expect(content).toContain(context.email);
      expect(content).toContain(context.snapshot.domain);
      expect(content).toContain('2,500');
      expect(content).toContain('My budget is flexible.');
      expect(content).toContain('Yes, tell me more.');
      expect(content).toContain('sample-reference');
    }
    expect(mail.subject).toContain('sample.example');
    expect(mail.html).toContain('Sample &lt;Buyer&gt;');
    expect(mail.html).not.toContain('<script>');
    expect(mail.text).toContain('<script>alert(1)</script>');
  });
  it('refuses owner-only or extra fields in the mail projection', () => {
    expect(
      salesEmailContextSchema.safeParse({ ...context, privateNote: 'PRIVATE' })
        .success,
    ).toBe(false);
    expect(
      salesEmailContextSchema.safeParse({
        ...context,
        latest: { ...context.latest, direction: 'private-note' },
      }).success,
    ).toBe(false);
  });
  it('has a working legacy fallback for old tenant mail envelopes', () => {
    const mail = renderSalesEmail(
      {
        subject: 'Confirm inquiry',
        url: 'https://accounts.example/i/sample',
        reference: 'sample-reference',
      },
      'verification',
    );
    expect(mail.text).toContain('https://accounts.example/i/sample');
    expect(mail.html).toContain('Confirm email address');
  });
  it('uses clear contact language and a primary inquiry action without seller wording', () => {
    const html = renderSalesLander(context.snapshot, '', 'test-only');
    expect(html).not.toMatch(/\bseller\b/i);
    expect(html).toContain('Get in touch');
    expect(html).toContain('Send inquiry');
    expect(html).toContain('email-hint');
  });
});
