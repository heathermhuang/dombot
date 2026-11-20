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

export interface EmailContent {
  subject: string;
  preheader: string;
  heading: string;
  intro?: string;
  details?: [string, string][];
  sections?: { label: string; body: string }[];
  recordGroups?: EmailRecordGroup[];
  action?: EmailLink;
  actionBeforeRecords?: boolean;
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
  const text = [
    c.heading,
    c.intro,
    '',
    ...details.map(([k, v]) => `${k}: ${v}`),
    ...sections.flatMap((s) => ['', s.label, s.body]),
    c.actionBeforeRecords ? actionText : undefined,
    ...recordGroups.flatMap((group) => [
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
    ]),
    c.code ? `\n${c.codeLabel ?? 'Code'}: ${c.code}` : undefined,
    ...(hasRecords
      ? [c.actionBeforeRecords ? undefined : actionText, c.note]
      : [c.note, actionText]),
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
  const noteHtml = c.note
    ? hasRecords
      ? `<p class="email-muted" style="font-size:14px;line-height:1.55;color:#475e50;margin:16px 0 0">${e(c.note)}</p>`
      : `<p>${e(c.note)}</p>`
    : '';
  const actionHtml = action
    ? `<p style="margin:24px 0${hasRecords ? ' 16px' : ''}"><a href="${e(action.url)}" style="display:inline-block;background:#234f3d;color:#fff;min-height:24px;padding:12px 20px;text-decoration:underline;border-radius:${hasRecords ? '8px' : '4px'}">${e(action.label)}</a></p>${hasRecords ? '' : `<p class="email-muted" style="font-size:14px;color:#475e50;overflow-wrap:anywhere">If the button does not work, open:<br><a class="email-link" style="color:#234f3d;text-decoration:underline" href="${e(action.url)}">${e(action.url)}</a></p>`}`
    : '';
  const bodyStyle = hasRecords
    ? 'class="email-bg" style="overflow-wrap:anywhere;word-break:break-word"'
    : 'class="email-card" style="background:#fff;border:1px solid #cbd6cd;padding:24px;overflow-wrap:anywhere;word-break:break-word"';
  const headingStyle = hasRecords
    ? 'font-size:30px;letter-spacing:-0.6px;line-height:1.15;margin:0 0 8px'
    : 'font-size:26px;line-height:1.25;margin:0 0 20px';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${e(c.subject)}</title><style>@media(prefers-color-scheme:dark){.email-bg{background:#10231b!important;color:#eff5ef!important}.email-card{background:#172e25!important;color:#eff5ef!important}.email-muted{color:#c1d0c4!important}.email-link{color:#c5e0d1!important}.email-inset{background:#243e31!important}.email-priority{color:#ffcf96!important}}</style></head><body class="email-bg" style="margin:0;background:#f7f8f4;color:#172e25;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6"><div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${e(c.preheader)}</div><table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:24px ${hasRecords ? '16px' : '12px'}"><table role="presentation" style="width:100%;max-width:600px;margin:auto;border-collapse:collapse;table-layout:fixed"><tr><td style="padding:0 0 20px;font-size:${hasRecords ? '19px' : '22px'};font-weight:700">domains.domains</td></tr><tr><td ${bodyStyle}><h1 style="${headingStyle}">${e(c.heading)}</h1>${c.intro ? `<p${hasRecords ? ' style="margin:0;line-height:1.5"' : ''}>${e(c.intro)}</p>` : ''}${details.length ? `<table role="presentation" style="width:100%;border-collapse:collapse;table-layout:fixed">${details.map(([k, v]) => `<tr><td class="email-muted" style="vertical-align:top;width:34%;padding:8px 12px 8px 0;color:#475e50;font-size:16px">${e(k)}</td><td style="padding:8px 0;overflow-wrap:anywhere;font-size:16px">${e(v)}</td></tr>`).join('')}</table>` : ''}${sections.map((s) => `<h2 style="font-size:18px;margin:24px 0 8px">${e(s.label)}</h2><div style="white-space:pre-wrap;overflow-wrap:anywhere">${e(s.body)}</div>`).join('')}${c.actionBeforeRecords ? actionHtml : ''}${recordHtml}${c.code ? `<p>${e(c.codeLabel ?? 'Code')}:</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px">${e(c.code)}</p>` : ''}${hasRecords ? (c.actionBeforeRecords ? '' : actionHtml) + noteHtml : noteHtml + actionHtml}</td></tr><tr><td class="email-muted" style="padding:20px 0;color:#475e50;font-size:14px;overflow-wrap:anywhere">${e(c.reason)}${preferences ? `<br><a class="email-link" style="color:#234f3d" href="${e(preferences)}">Email preferences and unsubscribe</a>` : ''}${c.reference ? `<br>Reference: ${e(c.reference)}` : ''}<br>Support: <a class="email-link" style="color:#234f3d" href="mailto:domains@domains.domains">domains@domains.domains</a><br>domains.domains · <a class="email-link" style="color:#234f3d" href="https://domains.domains/privacy">Privacy</a></td></tr></table></td></tr></table></body></html>`;
  return { subject: c.subject, text, html };
}
