import { describe, expect, it } from 'vitest';
import { renderEmail } from './email-layout';
describe('shared email presentation and trust boundary', () => {
  it('escapes every content field and keeps equivalent usable HTML and text actions', () => {
    const mail = renderEmail({
      subject: 'An update',
      preheader: 'A useful preview',
      heading: '<script>unsafe</script>',
      intro: 'Hello <Buyer>',
      details: [['Domain', 'sample.example']],
      sections: [{ label: 'Message', body: '<img onerror=alert(1)>' }],
      action: { label: 'Review', url: 'https://domains.domains/account' },
      reason: 'You requested this.',
      reference: 'safe-reference',
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('<img onerror');
    expect(mail.html).toContain('&lt;Buyer&gt;');
    expect(mail.text).toContain('Hello <Buyer>');
    for (const content of [mail.html, mail.text]) {
      expect(content).toContain('https://domains.domains/account');
      expect(content).toContain('domains@domains.domains');
      expect(content).toContain('safe-reference');
    }
    expect(mail.html).toContain('max-width:600px');
    expect(mail.html).toContain('prefers-color-scheme:dark');
  });
  it('rejects unsafe links and header injection rather than sending them', () => {
    const base = {
      subject: 'Update',
      preheader: 'Preview',
      heading: 'Update',
      reason: 'Requested',
    };
    for (const url of [
      'javascript:alert(1)',
      'http://external.example',
      'https://user:pass@domains.domains/',
    ])
      expect(() =>
        renderEmail({ ...base, action: { label: 'Go', url } }),
      ).toThrow();
    expect(() =>
      renderEmail({ ...base, subject: 'Hello\r\nBcc: other@example.com' }),
    ).toThrow();
  });
});
