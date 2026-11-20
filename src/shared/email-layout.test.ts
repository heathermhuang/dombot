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
      lead: { label: '<Message>', body: '<img onerror=alert(1)>' },
      action: { label: 'Review', url: 'https://domains.domains/account' },
      reason: 'You requested this.',
      reference: 'safe-reference',
      showActionUrl: true,
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
    expect(mail.html).toContain('&lt;Message&gt;');
    expect(mail.html).toContain('Copy the link if needed:');
    expect(mail.html.indexOf('&lt;Message&gt;')).toBeLessThan(
      mail.html.indexOf('>Review</a>'),
    );
    expect(mail.html.indexOf('>Review</a>')).toBeLessThan(
      mail.html.indexOf('sample.example'),
    );
    expect(mail.html).toContain('max-width:600px');
    expect(mail.html).toContain('prefers-color-scheme:dark');
  });
  it('escapes record content and validates registrar links like primary actions', () => {
    const base = {
      subject: 'Update',
      preheader: 'Preview',
      heading: 'Update',
      reason: 'Requested',
    };
    const record = {
      title: '<Domain>',
      status: '<Status>',
      facts: [['<Registrar>', '<Registrar name>'] as [string, string]],
      nextStep: '<img onerror=alert(1)>',
      link: { label: '<Go>', url: 'https://domains.domains/' },
      notes: ['<Note>'],
    };
    const group = { heading: '<Check>', records: [record] };
    const mail = renderEmail({ ...base, recordGroups: [group] });
    expect(mail.html).not.toContain('<img onerror');
    for (const field of [
      'Domain',
      'Status',
      'Registrar',
      'Registrar name',
      'Go',
      'Note',
      'Check',
    ])
      expect(mail.html).toContain(`&lt;${field}&gt;`);
    expect(mail.html).toContain('scope="row"');
    expect(mail.text).toContain('<Go>: https://domains.domains/');
    expect(() =>
      renderEmail({
        ...base,
        recordGroups: [
          {
            ...group,
            records: [
              {
                ...record,
                link: { ...record.link, url: 'javascript:alert(1)' },
              },
            ],
          },
        ],
      }),
    ).toThrow();
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
