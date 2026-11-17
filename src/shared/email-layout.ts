/** Shared, dependency-free email shell. Content is text, never caller-supplied HTML. */
export const escapeEmail = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

export interface EmailTable {
  caption: string;
  columns: string[];
  rows: { text: string; link?: { label: string; url: string } }[][];
}

export interface EmailContent {
  subject: string;
  preheader: string;
  heading: string;
  intro?: string;
  details?: [string, string][];
  sections?: { label: string; body: string }[];
  tables?: EmailTable[];
  action?: { label: string; url: string };
  code?: string;
  codeLabel?: string;
  note?: string;
  reference?: string;
  reason: string;
  preferencesUrl?: string;
}

export function emailUrl(value: string): string {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    (url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(url.hostname)
      ))
  )
    throw new Error('Email action requires a secure URL.');
  return url.href;
}

export function renderEmail(c: EmailContent) {
  if (!c.subject.trim() || /[\r\n]/.test(c.subject))
    throw new Error('Invalid email subject.');
  const action = c.action ? { ...c.action, url: emailUrl(c.action.url) } : null;
  const preferences = c.preferencesUrl ? emailUrl(c.preferencesUrl) : null;
  const details = c.details ?? [],
    sections = c.sections ?? [];
  const tables = (c.tables ?? []).map((table) => ({
    ...table,
    rows: table.rows.map((row) =>
      row.map((cell) => ({
        ...cell,
        link: cell.link
          ? { ...cell.link, url: emailUrl(cell.link.url) }
          : undefined,
      })),
    ),
  }));
  const text = [
    c.heading,
    c.intro,
    '',
    ...details.map(([k, v]) => `${k}: ${v}`),
    ...sections.flatMap((s) => ['', s.label, s.body]),
    ...tables.flatMap((table) => [
      '',
      table.caption,
      ...table.rows.flatMap((row) => [
        '',
        ...row.map(
          (cell, i) =>
            `${table.columns[i]}: ${cell.text}${cell.link ? `\n${cell.link.label}: ${cell.link.url}` : ''}`,
        ),
      ]),
    ]),
    c.code ? `\n${c.codeLabel ?? 'Code'}: ${c.code}` : undefined,
    c.note,
    action ? `\n${action.label}: ${action.url}` : undefined,
    '',
    c.reason,
    preferences ? `Email preferences: ${preferences}` : undefined,
    c.reference ? `Reference: ${c.reference}` : undefined,
    'Support: domains@domains.domains',
    'Privacy: https://domains.domains/privacy',
    'domains.domains',
  ]
    .filter((v) => v !== undefined)
    .join('\n');
  const e = escapeEmail;
  const tableHtml = tables
    .map(
      (table) =>
        `<table class="email-data" style="width:100%;border-collapse:collapse;table-layout:fixed;margin:24px 0;font-size:16px;line-height:1.45"><caption style="text-align:left;font-size:18px;font-weight:bold;padding:0 0 12px">${e(table.caption)}</caption><thead><tr>${table.columns.map((label) => `<th scope="col" style="text-align:left;vertical-align:top;padding:8px 6px;border-bottom:2px solid #cbd6cd">${e(label)}</th>`).join('')}</tr></thead><tbody>${table.rows.map((row) => `<tr>${row.map((cell, i) => `<td data-label="${e(table.columns[i])}" style="vertical-align:top;padding:12px 6px;border-bottom:1px solid #cbd6cd;overflow-wrap:anywhere;word-break:break-word"><span style="white-space:pre-wrap">${e(cell.text).replace(/\b\d{4}-\d{2}-\d{2}\b/g, (date) => `<span style="white-space:nowrap">${date}</span>`)}</span>${cell.link ? `<br><a class="email-link" style="color:#234f3d;text-decoration:underline;display:inline-block;padding:10px 0" href="${e(cell.link.url)}">${e(cell.link.label)}</a>` : ''}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
    )
    .join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${e(c.subject)}</title><style>@media(max-width:480px){.email-data thead{display:none!important}.email-data tr,.email-data td{display:block!important;width:auto!important}.email-data tr{padding:8px 0;border-bottom:2px solid #cbd6cd}.email-data td{border-bottom:0!important;padding:6px 0!important}.email-data td:before{content:attr(data-label) ": ";font-weight:bold}}@media(prefers-color-scheme:dark){.email-bg{background:#10231b!important;color:#eff5ef!important}.email-card{background:#172e25!important;color:#eff5ef!important}.email-muted{color:#c1d0c4!important}.email-link{color:#c5e0d1!important}}</style></head><body class="email-bg" style="margin:0;background:#f7f8f4;color:#172e25;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6"><div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${e(c.preheader)}</div><table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:24px 12px"><table role="presentation" style="width:100%;max-width:600px;margin:auto;border-collapse:collapse;table-layout:fixed"><tr><td style="padding:0 0 20px;font-size:22px;font-weight:700">domains.domains</td></tr><tr><td class="email-card" style="background:#fff;border:1px solid #cbd6cd;padding:24px;overflow-wrap:anywhere;word-break:break-word"><h1 style="font-size:26px;line-height:1.25;margin:0 0 20px">${e(c.heading)}</h1>${c.intro ? `<p>${e(c.intro)}</p>` : ''}${details.length ? `<table role="presentation" style="width:100%;border-collapse:collapse;table-layout:fixed">${details.map(([k, v]) => `<tr><td class="email-muted" style="vertical-align:top;width:34%;padding:8px 12px 8px 0;color:#475e50;font-size:16px">${e(k)}</td><td style="padding:8px 0;overflow-wrap:anywhere;font-size:16px">${e(v)}</td></tr>`).join('')}</table>` : ''}${sections.map((s) => `<h2 style="font-size:18px;margin:24px 0 8px">${e(s.label)}</h2><div style="white-space:pre-wrap;overflow-wrap:anywhere">${e(s.body)}</div>`).join('')}${tableHtml}${c.code ? `<p>${e(c.codeLabel ?? 'Code')}:</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px">${e(c.code)}</p>` : ''}${c.note ? `<p>${e(c.note)}</p>` : ''}${action ? `<p style="margin:24px 0"><a href="${e(action.url)}" style="display:inline-block;background:#234f3d;color:#fff;min-height:24px;padding:12px 20px;text-decoration:underline;border-radius:4px">${e(action.label)}</a></p><p class="email-muted" style="font-size:14px;color:#475e50;overflow-wrap:anywhere">If the button does not work, open:<br><a class="email-link" style="color:#234f3d;text-decoration:underline" href="${e(action.url)}">${e(action.url)}</a></p>` : ''}</td></tr><tr><td class="email-muted" style="padding:20px 0;color:#475e50;font-size:14px;overflow-wrap:anywhere">${e(c.reason)}${preferences ? `<br><a class="email-link" style="color:#234f3d" href="${e(preferences)}">Email preferences and unsubscribe</a>` : ''}${c.reference ? `<br>Reference: ${e(c.reference)}` : ''}<br>Support: <a class="email-link" style="color:#234f3d" href="mailto:domains@domains.domains">domains@domains.domains</a><br>domains.domains · <a class="email-link" style="color:#234f3d" href="https://domains.domains/privacy">Privacy</a></td></tr></table></td></tr></table></body></html>`;
  return { subject: c.subject, text, html };
}
