/** Shared, dependency-free email shell. Content is text, never caller-supplied HTML. */
export const escapeEmail = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

interface EmailLink {
  label: string;
  url: string;
}

export interface EmailRecord {
  title: string;
  status: string;
  facts: [label: string, value: string][];
  nextStep: string;
  link?: EmailLink;
  notes: string[];
}

export interface EmailRecordGroup {
  heading?: string;
  priority?: boolean;
  records: EmailRecord[];
}

interface EmailSection {
  label: string;
  body: string;
}

export interface EmailContent {
  subject: string;
  preheader: string;
  heading: string;
  intro?: string;
  details?: [string, string][];
  lead?: EmailSection;
  sections?: EmailSection[];
  recordGroups?: EmailRecordGroup[];
  action?: EmailLink;
  actionBeforeRecords?: boolean;
  showActionUrl?: boolean;
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
  const recordGroups = (c.recordGroups ?? []).map((group) => ({
    ...group,
    records: group.records.map((record) => ({
      ...record,
      link: record.link
        ? { ...record.link, url: emailUrl(record.link.url) }
        : undefined,
    })),
  }));
  const hasRecords = c.recordGroups !== undefined;
  const actionText = action ? `\n${action.label}: ${action.url}` : undefined;
  const detailText = details.map(([label, value]) => `${label}: ${value}`);
  const sectionText = sections.flatMap(({ label, body }) => ['', label, body]);
  const recordText = recordGroups.flatMap((group) => [
    ...(group.heading ? ['', group.heading] : []),
    ...group.records.flatMap((record) => [
      '',
      record.title,
      record.status,
      ...record.facts.map(([label, value]) => `${label}: ${value}`),
      `Next step: ${record.nextStep}`,
      ...(record.link ? [`${record.link.label}: ${record.link.url}`] : []),
      ...record.notes,
    ]),
  ]);
  const codeText = c.code ? `\n${c.codeLabel ?? 'Code'}: ${c.code}` : undefined;
  const text = [
    c.heading,
    c.intro,
    '',
    ...(c.lead ? [c.lead.label, c.lead.body] : []),
    ...(hasRecords
      ? [
          ...detailText,
          ...sectionText,
          c.actionBeforeRecords ? actionText : undefined,
          ...recordText,
          codeText,
          c.actionBeforeRecords ? undefined : actionText,
        ]
      : [actionText, codeText, ...detailText, ...sectionText]),
    c.note,
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
  const recordHtml = recordGroups
    .map((group) => {
      const statusClass = group.priority ? 'email-priority' : 'email-muted';
      const statusColor = group.priority ? '#845018' : '#475e50';
      const titleTag = group.heading ? 'h3' : 'h2';
      const groupHeading = group.heading
        ? `<h2 style="font-size:15px;line-height:1.4;margin:0 0 8px">${e(group.heading)}</h2>`
        : '';
      return `<div style="margin-top:18px">${groupHeading}
${group.records
  .map(
    (
      record,
    ) => `<table role="presentation" style="width:100%;table-layout:fixed;border-spacing:0;margin-bottom:12px"><tr><td class="email-card" style="padding:16px;background:#fff;border:1px solid #cbd6cd;border-radius:12px;overflow-wrap:anywhere;word-break:break-word">
<${titleTag} style="font-size:22px;letter-spacing:-0.35px;line-height:1.2;margin:0 0 4px">${e(record.title)}</${titleTag}>
<p class="${statusClass}" style="color:${statusColor};font-size:14px;line-height:1.4;font-weight:bold;margin:0 0 12px">${e(record.status)}</p>
<table style="width:100%;border-collapse:collapse;table-layout:fixed;line-height:1.4"><tbody>
${record.facts.map(([label, value]) => `<tr><th scope="row" class="email-muted" style="width:38%;text-align:left;vertical-align:top;font-size:14px;color:#475e50;font-weight:normal;padding:4px 8px 4px 0">${e(label)}</th><td style="font-size:16px;vertical-align:top;font-weight:bold;padding:3px 0">${e(value)}</td></tr>`).join('')}
</tbody></table>
<div class="email-inset" style="background:#eef3eb;border-radius:8px;margin-top:12px;padding:10px 12px">
<p style="margin:0;font-size:14px;font-weight:bold;line-height:1.4">Next step</p>
<p style="margin:3px 0 0;font-size:16px;line-height:1.45">${e(record.nextStep)}</p>
${record.link ? `<a class="email-link" style="color:#234f3d;display:inline-block;padding:10px 0;line-height:24px;font-size:16px;font-weight:bold;text-decoration:underline" href="${e(record.link.url)}">${e(record.link.label)}</a>` : ''}
</div>
<p class="email-muted" style="font-size:14px;line-height:1.5;margin:10px 0 0;color:#475e50">${record.notes.map(e).join(' · ')}</p>
</td></tr></table>`,
  )
  .join('')}</div>`;
    })
    .join('');
  const actionHtml = action
    ? `<p style="margin:24px 0 16px"><a href="${e(action.url)}" style="display:inline-block;background:#234f3d;color:#fff;min-height:24px;padding:12px 20px;text-decoration:underline;border-radius:8px">${e(action.label)}</a></p>`
    : '';
  const noteHtml = c.note
    ? `<p class="email-muted" style="font-size:14px;line-height:1.55;color:#475e50;margin:16px 0 0">${e(c.note)}</p>`
    : '';
  const detailHtml = details.length
    ? `<table style="width:100%;border-collapse:collapse;table-layout:fixed;margin-top:16px"><tbody>${details.map(([label, value]) => `<tr><th scope="row" class="email-muted" style="vertical-align:top;text-align:left;width:34%;padding:5px 10px 5px 0;color:#475e50;font-size:14px;font-weight:normal">${e(label)}</th><td style="vertical-align:top;padding:4px 0;overflow-wrap:anywhere;font-size:16px">${e(value)}</td></tr>`).join('')}</tbody></table>`
    : '';
  const sectionHtml = sections
    .map(
      ({ label, body }) =>
        `<h2 style="font-size:16px;margin:20px 0 4px">${e(label)}</h2><div style="white-space:pre-wrap;overflow-wrap:anywhere">${e(body)}</div>`,
    )
    .join('');
  const leadHtml = c.lead
    ? `<table role="presentation" style="width:100%;table-layout:fixed;border-spacing:0;margin-top:18px"><tr><td class="email-card" style="padding:16px;background:#fff;border:1px solid #cbd6cd;border-radius:12px;overflow-wrap:anywhere;word-break:break-word"><h2 style="font-size:14px;margin:0 0 4px">${e(c.lead.label)}</h2><div style="white-space:pre-wrap;overflow-wrap:anywhere">${e(c.lead.body)}</div></td></tr></table>`
    : '';
  const codeHtml = c.code
    ? `<div class="email-inset" style="background:#eef3eb;border-radius:8px;margin-top:16px;padding:12px 16px"><p style="margin:0;font-size:14px;line-height:1.4">${e(c.codeLabel ?? 'Code')}</p><p style="margin:4px 0 0;font-family:monospace;font-size:28px;font-weight:bold;letter-spacing:4px;line-height:1.35">${e(c.code)}</p></div>`
    : '';
  const fallbackHtml =
    action && c.showActionUrl
      ? `<p class="email-muted" style="font-size:14px;line-height:1.55;color:#475e50;overflow-wrap:anywhere">Copy the link if needed:<br><a class="email-link" style="color:#234f3d;text-decoration:underline" href="${e(action.url)}">${e(action.url)}</a></p>`
      : '';
  const contentHtml = hasRecords
    ? detailHtml +
      sectionHtml +
      (c.actionBeforeRecords ? actionHtml : '') +
      recordHtml +
      codeHtml +
      (c.actionBeforeRecords ? '' : actionHtml)
    : actionHtml + codeHtml + detailHtml + sectionHtml;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${e(c.subject)}</title><style>@media(prefers-color-scheme:dark){.email-bg{background:#10231b!important;color:#eff5ef!important}.email-card{background:#172e25!important;color:#eff5ef!important}.email-muted{color:#c1d0c4!important}.email-link{color:#c5e0d1!important}.email-inset{background:#243e31!important}.email-priority{color:#ffcf96!important}}</style></head>
<body class="email-bg" style="margin:0;background:#f7f8f4;color:#172e25;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${e(c.preheader)}</div>
<table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:24px 16px">
<table role="presentation" style="width:100%;max-width:600px;margin:auto;border-collapse:collapse;table-layout:fixed">
<tr><td style="padding:0 0 20px;font-size:19px;font-weight:700">domains.domains</td></tr>
<tr><td class="email-bg" style="overflow-wrap:anywhere;word-break:break-word">
<h1 style="font-size:30px;letter-spacing:-0.6px;line-height:1.15;margin:0 0 8px">${e(c.heading)}</h1>${c.intro ? `<p style="margin:0;line-height:1.5">${e(c.intro)}</p>` : ''}
${leadHtml}${contentHtml}${noteHtml}${fallbackHtml}</td></tr>
<tr><td class="email-muted" style="padding:20px 0;color:#475e50;font-size:14px;overflow-wrap:anywhere">${e(c.reason)}${preferences ? `<br><a class="email-link" style="color:#234f3d" href="${e(preferences)}">Email preferences and unsubscribe</a>` : ''}${c.reference ? `<br>Reference: ${e(c.reference)}` : ''}<br>Support: <a class="email-link" style="color:#234f3d" href="mailto:domains@domains.domains">domains@domains.domains</a><br>domains.domains · <a class="email-link" style="color:#234f3d" href="https://domains.domains/privacy">Privacy</a></td></tr>
</table></td></tr></table></body></html>`;
  return { subject: c.subject, text, html };
}
