// Hosted-only MIME dependencies resolve from hosted/node_modules.
import PostalMime, { addressParser } from 'postal-mime';
import { convert } from 'html-to-text';
import { redactRelaySecrets } from '../src/shared/sales-relay';

export class RelayInputError extends Error {}
const RAW_LIMIT = 256 * 1024;

export async function parseRelayEmail(message: ForwardableEmailMessage) {
  if (message.rawSize <= 0 || message.rawSize > RAW_LIMIT)
    throw new RelayInputError(
      'Reply exceeds 256 KiB. Send a text reply without attachments.',
    );
  const reader = message.raw.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > RAW_LIMIT) {
      await reader.cancel();
      throw new RelayInputError(
        'Reply exceeds 256 KiB. Send a text reply without attachments.',
      );
    }
    chunks.push(value);
  }
  const raw = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.length;
  }
  let mail;
  try {
    mail = await PostalMime.parse(raw, {
      maxNestingDepth: 8,
      maxHeadersSize: 16384,
      maxPartCount: 20,
      maxRfc822NestingDepth: 0,
      forceRfc822Attachments: true,
    });
  } catch {
    throw new RelayInputError(
      'Reply format is too complex. Send a plain text reply.',
    );
  }
  const fromHeaders = mail.headers.filter((h) => h.key === 'from');
  const addresses =
    fromHeaders.length === 1
      ? addressParser(fromHeaders[0].value, { flatten: true })
      : [];
  if (
    addresses.length !== 1 ||
    !addresses[0].address ||
    mail.headers.filter((h) => h.key === 'from').length !== 1 ||
    !mail.from ||
    !mail.from.address ||
    mail.from.group
  )
    throw new RelayInputError('Reply must have one From address.');
  if (
    mail.headers.filter((h) => h.key === 'message-id').length !== 1 ||
    !mail.messageId
  )
    throw new RelayInputError('Reply must include a Message-ID.');
  if (
    mail.headers.some(
      (h) =>
        h.key === 'auto-submitted' && h.value.trim().toLowerCase() !== 'no',
    ) ||
    mail.headers.some(
      (h) =>
        h.key === 'precedence' && /^(bulk|junk|list)$/i.test(h.value.trim()),
    ) ||
    mail.headers.some((h) => h.key === 'list-id') ||
    (mail.references?.split(/\s+/).length ?? 0) > 100
  )
    throw new RelayInputError(
      'Automated or mailing-list replies are not recorded.',
    );
  if (
    mail.attachments.some(
      (a) =>
        !(
          a.mimeType.startsWith('image/') &&
          (a.disposition === 'inline' || a.related)
        ),
    )
  )
    throw new RelayInputError(
      'Attachments are not supported. Send your message as text.',
    );
  let text =
    mail.text ??
    (mail.html
      ? convert(mail.html, {
          wordwrap: false,
          selectors: [
            { selector: 'img', format: 'skip' },
            { selector: 'script', format: 'skip' },
            { selector: 'style', format: 'skip' },
            { selector: 'a', options: { ignoreHref: true } },
          ],
        })
      : '');
  // Normal top-posted Gmail/Apple Mail and Outlook replies. Never fetch body URLs.
  text = text.replace(/\r\n?/g, '\n');
  const boundary =
    /\n(?:On [\s\S]{0,350}?wrote:\s*\n\s*>|_{5,}\s*\nFrom:|From:[^\n]+\nSent:[\s\S]{0,350}?\nTo:|-{2,}\s*Original Message\s*-{2,})/i.exec(
      text,
    );
  if (boundary) text = text.slice(0, boundary.index);
  text = redactRelaySecrets(text).trim();
  if (!text || text.length > 4000)
    throw new RelayInputError(
      'Reply text must be 1–4000 characters. Remove quoted history or use the conversation link.',
    );
  return {
    from: addresses[0].address.toLowerCase(),
    messageId: mail.messageId,
    body: text,
  };
}
