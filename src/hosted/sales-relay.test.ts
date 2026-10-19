import { describe, it, expect } from 'vitest';
import { parseRelayEmail } from '../../hosted/email';
import { relayMessageSchema } from '../shared/sales-relay';
import { newReplyAddress, relaySettings } from './sales-relay-address';

const workspace = '11111111-1111-4111-8111-111111111111';
const alias = `reply+11111111.${'ab'.repeat(24)}@replies.example`;
export function incoming(
  raw: string,
  overrides: Partial<ForwardableEmailMessage> = {},
) {
  return {
    from: 'owner@example.com',
    to: alias,
    raw: new Response(raw).body!,
    rawSize: new TextEncoder().encode(raw).length,
    headers: new Headers(),
    setReject() {},
    forward() {
      throw Error('Raw forwarding must not be used');
    },
    reply() {
      throw Error('SMTP replies must use the fenced outbox');
    },
    ...overrides,
  } as ForwardableEmailMessage;
}
const plain = (body = 'A normal reply', extra = '') =>
  `From: Owner <owner@example.com>\r\nTo: ${alias}\r\nMessage-ID: <one@fixture.example>\r\n${extra}Content-Type: text/plain; charset=utf-8\r\n\r\n${body}`;
describe('bounded inbound MIME projection', () => {
  it('records the new text of normal replies and omits quoted capability credentials', async () => {
    const value = await parseRelayEmail(
      incoming(
        plain(
          `A normal reply\n\nOn Monday, Sample wrote:\n> reply+11111111.${'ef'.repeat(24)}@replies.example\n> https://accounts.example/w/${workspace}/t/${'x'.repeat(43)}`,
        ),
      ),
    );
    expect(value).toEqual({
      from: 'owner@example.com',
      messageId: '<one@fixture.example>',
      body: 'A normal reply',
    });
  });
  it.each([
    'On Mon, 19 Oct 2026, "Example" <example@example.com> wrote:',
    'On Mon, 19 Oct 2026, "Example"\n<example@example.com> wrote:',
  ])(
    'trims email attributions without quote-prefix markers: %s',
    async (attribution) => {
      const value = await parseRelayEmail(
        incoming(
          plain(
            'My new reply.\n\n' +
              attribution +
              '\n\n' +
              'Old conversation history. '.repeat(300),
          ),
        ),
      );
      expect(value.body).toBe('My new reply.');
    },
  );
  it('keeps ordinary prose without an email attribution or quote prefix', async () => {
    const body = 'My thoughts:\nOn Monday, an author wrote:\nA quoted passage.';
    expect((await parseRelayEmail(incoming(plain(body)))).body).toBe(body);
  });
  it.each(['a'.repeat(65) + '@example.com', 'a@b@example.com'])(
    'preserves prose with a malformed sender-like address: %s',
    async (address) => {
      const body =
        'My thoughts:\nOn Monday, someone <' +
        address +
        '> wrote:\nA quoted passage.';
      expect((await parseRelayEmail(incoming(plain(body)))).body).toBe(body);
    },
  );
  it('ignores authentication-result, routing and reply headers as authority', async () => {
    const value = await parseRelayEmail(
      incoming(
        plain(
          `See ${alias} and https://accounts.example/t/${'x'.repeat(43)}`,
          'Authentication-Results: mx.cloudflare.net; dmarc=pass\r\nReply-To: attacker@example.net\r\nCc: attacker@example.net\r\n',
        ),
      ),
    );
    expect(value.from).toBe('owner@example.com');
    expect(value.body).not.toContain('ab'.repeat(24));
    expect(value.body).not.toContain('x'.repeat(43));
    expect(value.body).not.toContain('attacker');
  });
  it('converts HTML without executing or fetching its links and images', async () => {
    const raw = plain()
      .replace('text/plain', 'text/html')
      .replace(
        'A normal reply',
        '<p>My reply &amp; question.</p><script>bad()</script><img src="https://tracker.example/pixel"><a href="https://tracker.example">Details</a>',
      );
    const value = await parseRelayEmail(incoming(raw));
    expect(value.body).toContain('My reply & question.');
    expect(value.body).not.toContain('bad()');
    expect(value.body).not.toContain('tracker.example');
  });
  it('omits Gmail HTML reply history before conversion and the new-text length check', async () => {
    const raw = plain()
      .replace('text/plain', 'text/html')
      .replace(
        'A normal reply',
        '<p>My new reply.</p><br><br><div class="gmail_quote">On Mon, 19 Oct 2026, &quot;Example&quot; &lt;example@example.com&gt; wrote:<br><blockquote><div style="white-space: pre-wrap;">' +
          'Old conversation history. '.repeat(300) +
          '</div></blockquote></div>',
      );
    const value = await parseRelayEmail(incoming(raw));
    expect(value.body).toBe('My new reply.');
  });
  it('uses HTML quote boundaries when the plain alternative has lost that structure', async () => {
    const raw = `From: owner@example.com\r\nTo: ${alias}\r\nMessage-ID: <multipart@fixture.example>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary="fixture"\r\n\r\n--fixture\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nMy new reply.\r\nOld history without a plain-text attribution.\r\n--fixture\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>My new reply.</p><div class="gmail_quote">Old history without a plain-text attribution.</div>\r\n--fixture--\r\n`;
    expect((await parseRelayEmail(incoming(raw))).body).toBe('My new reply.');
  });
  it.each([
    '<div class="gmail_quote">Only old history</div>',
    '<p>' + 'x'.repeat(4001) + '</p>',
  ])(
    'does not fall back to plaintext when sanitized HTML is empty or too long',
    async (html) => {
      const raw = `From: owner@example.com\r\nTo: ${alias}\r\nMessage-ID: <multipart-limits@fixture.example>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary="fixture"\r\n\r\n--fixture\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nOld history.\r\n--fixture\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}\r\n--fixture--\r\n`;
      await expect(parseRelayEmail(incoming(raw))).rejects.toThrow(
        'Reply text must be',
      );
    },
  );
  it.each([
    'From: second@example.com\r\n',
    'Message-ID: <two@example.com>\r\n',
    'Auto-Submitted: auto-replied\r\n',
    'Precedence: bulk\r\n',
    'List-ID: <list@example.com>\r\n',
  ])('rejects ambiguous or automated headers: %s', async (extra) => {
    await expect(
      parseRelayEmail(incoming(plain('Reply', extra))),
    ).rejects.toThrow();
  });
  it('rejects multiple From mailboxes, attached messages, and overlength new text', async () => {
    await expect(
      parseRelayEmail(
        incoming(
          plain().replace(
            'Owner <owner@example.com>',
            'owner@example.com, other@example.com',
          ),
        ),
      ),
    ).rejects.toThrow();
    await expect(
      parseRelayEmail(incoming(plain('x'.repeat(4001)))),
    ).rejects.toThrow();
    const nested =
      'From: owner@example.com\r\nMessage-ID: <outer@example.com>\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\nContent-Type: text/plain\r\n\r\nHello\r\n--x\r\nContent-Type: message/rfc822\r\n\r\n' +
      plain('private forwarded email') +
      '\r\n--x--';
    await expect(parseRelayEmail(incoming(nested))).rejects.toThrow();
  });
  it('enforces the actual stream byte limit even if the advertised size is false', async () => {
    await expect(
      parseRelayEmail(incoming(plain('x'.repeat(257 * 1024)), { rawSize: 20 })),
    ).rejects.toThrow('256 KiB');
  });
  it('rejects excessive MIME nesting and part counts', async () => {
    const many =
      'From: owner@example.com\r\nMessage-ID: <many@example.com>\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n' +
      Array.from(
        { length: 22 },
        () => '--x\r\nContent-Type: text/plain\r\n\r\npart\r\n',
      ).join('') +
      '--x--';
    await expect(parseRelayEmail(incoming(many))).rejects.toThrow('complex');
  });
  it('validates message identity before an internal request is made', () => {
    expect(
      relayMessageSchema.safeParse({
        token: 'ab'.repeat(24),
        from: 'owner@example.com',
        ownerEmail: 'owner@example.com',
        body: 'reply',
        messageId: 'bad\r\nCc: attacker@example.com',
      }).success,
    ).toBe(false);
  });
});
describe('private reply address generation', () => {
  const env = {
    SALES_RELAY_ENABLED: 'true',
    SALES_RELAY_ADDRESS: 'reply@replies.example',
    SALES_RELAY_WORKSPACES: JSON.stringify([workspace]),
    WORKSPACES: JSON.stringify([
      { id: workspace, binding: 'WORKSPACE_0', label: 'Fixture' },
    ]),
  } as HostedEnv;
  it('generates separate 192-bit aliases within the SMTP local-part limit', () => {
    const a = newReplyAddress(env, workspace)!,
      b = newReplyAddress(env, workspace)!;
    expect(a.address).not.toBe(b.address);
    expect(a.raw).toMatch(/^[a-f0-9]{48}$/);
    expect(a.address.split('@')[0].length).toBeLessThanOrEqual(64);
  });
  it('fails closed for disabled/unlisted/ambiguous workspaces', () => {
    expect(
      newReplyAddress({ ...env, SALES_RELAY_ENABLED: 'false' }, workspace),
    ).toBeNull();
    expect(
      newReplyAddress({ ...env, SALES_RELAY_WORKSPACES: '[]' }, workspace),
    ).toBeNull();
    expect(() =>
      relaySettings(
        {
          ...env,
          WORKSPACES: JSON.stringify([
            { id: workspace, binding: 'WORKSPACE_0', label: 'One' },
            {
              id: '11111111-2222-4222-8222-222222222222',
              binding: 'WORKSPACE_1',
              label: 'Two',
            },
          ]),
        },
        workspace,
      ),
    ).toThrow();
  });
});
