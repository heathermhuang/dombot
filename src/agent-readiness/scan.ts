import { canonicalDomain } from '../shared/publication';
import { isPublicIpv4 } from '../shared/proxy';

const types = { A: 1, AAAA: 28, TXT: 16, HTTPS: 65, SVCB: 64 };
type DnsType = keyof typeof types;
type DnsAnswer = { type: number; data: string };
export type ProbeFetch = typeof fetch;

export async function boundedText(response: Response, maxBytes: number) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > maxBytes) throw new Error('Response exceeds the scan limit');
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function scanDomain(raw: string) {
  const value = raw.trim().replace(/\.$/, '');
  if (!value || /[/:?@#\\%\s]/u.test(value))
    throw new Error('Enter a domain name.');
  const domain = canonicalDomain(value);
  if (
    domain.split('.').some((part) => part.length > 63) ||
    /(?:^|\.)(?:localhost|local|internal|home|lan|test|invalid|onion|arpa)$/i.test(
      domain,
    )
  )
    throw new Error('Enter a publicly resolvable domain name.');
  return domain;
}

export async function lookup(
  name: string,
  type: DnsType,
  send: ProbeFetch = fetch,
  signal = AbortSignal.timeout(4000),
): Promise<DnsAnswer[]> {
  const url = new URL('https://cloudflare-dns.com/dns-query');
  url.searchParams.set('name', name);
  url.searchParams.set('type', type);
  const response = await send(url.href, {
    headers: { Accept: 'application/dns-json' },
    redirect: 'manual',
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('Public DNS unavailable');
  }
  const data = JSON.parse(await boundedText(response, 32768)) as {
    Status?: number;
    Answer?: DnsAnswer[];
  };
  if (data.Status !== 0 && data.Status !== 3)
    throw new Error('Public DNS returned an error');
  return (data.Answer ?? []).filter(
    (item) => item.type === types[type] && typeof item.data === 'string',
  );
}

export function mcpDiscoveryUrl(raw: string): string | null {
  // A DoH TXT answer can contain multiple character strings from one record.
  const chunks = [...raw.matchAll(/"((?:[^"\\]|\\.)*)"/g)];
  const fields = (chunks.length ? chunks.map((part) => part[1]).join('') : raw)
    .split(';')
    .map((field) => field.trim());
  if (fields.shift() !== 'v=mcp1') return null;
  const urls = fields.filter((field) => field.startsWith('url='));
  if (urls.length !== 1) return null;
  try {
    const url = new URL(urls[0].slice(4));
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.hash
      ? url.href
      : null;
  } catch {
    return null;
  }
}

type Page = { text: string; url: URL; type: string; links: string };
function publicV6(ip: string) {
  // Admit global unicast only. Exclude IETF special assignments, documentation and 6to4.
  return (
    /^(?:[23][0-9a-f]{3}):[0-9a-f:]+$/i.test(ip) &&
    !/^(?:2001:(?:[0-9a-f]{1,2}:|db8:|:)|2002:|3fff:)/i.test(ip)
  );
}

async function readPage(
  initial: URL,
  send: ProbeFetch,
  signal: AbortSignal,
  dns: Map<string, Promise<boolean>>,
): Promise<Page | null> {
  let url = initial;
  for (let redirects = 0; redirects <= 2; redirects++) {
    const hostname = scanDomain(url.hostname);
    if (url.protocol !== 'https:' || url.port || url.username || url.password)
      return null;
    if (!dns.has(hostname)) {
      dns.set(
        hostname,
        Promise.all([
          lookup(hostname, 'A', send, signal),
          lookup(hostname, 'AAAA', send, signal),
        ]).then(
          ([a, aaaa]) =>
            a.length + aaaa.length > 0 &&
            a.every((item) => isPublicIpv4(item.data)) &&
            aaaa.every((item) => publicV6(item.data)),
        ),
      );
    }
    if (!(await dns.get(hostname))) return null;
    const response = await send(url.href, {
      headers: {
        Accept: 'text/html, text/plain, text/markdown, application/json',
      },
      redirect: 'manual',
      signal,
    });
    const location = response.headers.get('Location');
    if ([301, 302, 303, 307, 308].includes(response.status) && location) {
      await response.body?.cancel();
      url = new URL(location, url);
      continue;
    }
    const type = response.headers.get('Content-Type') ?? '';
    if (
      !response.ok ||
      !/^(?:text\/(?:html|plain|markdown)|application\/(?:json|[^;]+\+json))(?:;|$)/i.test(
        type,
      )
    ) {
      await response.body?.cancel();
      return null;
    }
    return {
      url,
      type,
      text: await boundedText(response, 768 * 1024),
      links: response.headers.get('Link') ?? '',
    };
  }
  return null;
}

function objects(input: unknown, depth = 0): Record<string, unknown>[] {
  if (!input || typeof input !== 'object' || depth > 5) return [];
  if (Array.isArray(input))
    return input.slice(0, 30).flatMap((item) => objects(item, depth + 1));
  const item = input as Record<string, unknown>;
  return [
    item,
    ...[
      '@graph',
      'mainEntity',
      'offers',
      'priceSpecification',
      'askingPrice',
      'publicPrice',
    ].flatMap((key) => objects(item[key], depth + 1)),
  ];
}
function structuredPrice(input: unknown) {
  return objects(input).some((item) => {
    const amount = item.price ?? item.amount;
    const currency = item.priceCurrency ?? item.currency;
    return (
      (typeof amount === 'string' || typeof amount === 'number') &&
      /^\d{1,16}(?:\.\d{1,8})?$/.test(String(amount)) &&
      Number(amount) > 0 &&
      typeof currency === 'string' &&
      /^[A-Z]{3}$/.test(currency)
    );
  });
}
function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
function attr(tag: string, key: string) {
  const match = tag.match(
    new RegExp(
      '\\s' + key + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))',
      'i',
    ),
  );
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}
function pricingUrl(page: Page): URL | null {
  const links = page.text.match(/<link\b[^>]*>/gi) ?? [];
  const alternate = links.find(
    (tag) =>
      /\b(?:alternate|describedby)\b/i.test(attr(tag, 'rel')) &&
      /^application\/(?:[^;]+\+)?json$/i.test(attr(tag, 'type')),
  );
  const linkHeader = [...page.links.matchAll(/<([^>]+)>([^,]*)/g)].find(
    (link) =>
      /rel="?\b(?:alternate|describedby)\b/i.test(link[2]) &&
      /type="?application\/(?:[^;"]+\+)?json/i.test(link[2]),
  );
  try {
    const href = (alternate && attr(alternate, 'href')) || linkHeader?.[1];
    return href ? new URL(href, page.url) : null;
  } catch {
    return null;
  }
}

export const readinessChecks = [
  {
    id: 'lander',
    label: 'For-sale landing page',
    points: 20,
    fix: 'Publish a landing page that clearly invites a domain purchase, offer, or inquiry.',
  },
  {
    id: 'structuredPrice',
    label: 'Machine-readable price',
    points: 20,
    fix: 'Advertise an asking amount and ISO currency in structured data or a linked JSON listing.',
  },
  {
    id: 'mcp',
    label: 'MCP DNS discovery',
    points: 15,
    fix: 'Publish a valid _mcp TXT record with a v=mcp1 HTTPS endpoint.',
  },
  {
    id: 'llms',
    label: 'Agent discovery file',
    points: 10,
    fix: 'Serve a domain listing index at /llms.txt or advertise an equivalent discovery file.',
  },
  {
    id: 'anonymousPrice',
    label: 'Anonymous pricing API',
    points: 15,
    fix: 'Link a public JSON listing whose price can be read without credentials.',
  },
  {
    id: 'completion',
    label: 'Purchase or offer route',
    points: 15,
    fix: 'Advertise a checkout, offer, or broker inquiry route.',
  },
  {
    id: 'dns',
    label: 'Machine-parseable DNS discovery',
    points: 5,
    fix: 'Publish a valid MCP TXT, HTTPS, or agent service binding record.',
  },
] as const;
type CheckId = (typeof readinessChecks)[number]['id'];
type Evidence = Partial<Record<CheckId, string>>;
export function scoreReadiness(evidence: Evidence, unknown: CheckId[] = []) {
  const checks = readinessChecks.map((check) => ({
    ...check,
    status: evidence[check.id]
      ? ('pass' as const)
      : unknown.includes(check.id)
        ? ('unverified' as const)
        : ('missing' as const),
    detail: evidence[check.id] ?? check.fix,
  }));
  return {
    score: checks.reduce(
      (total, check) => total + (check.status === 'pass' ? check.points : 0),
      0,
    ),
    checks,
  };
}

export async function scanReadiness(domain: string, send: ProbeFetch = fetch) {
  const dns = new Map<string, Promise<boolean>>();
  const signal = AbortSignal.timeout(8000);
  const home = new URL('https://' + scanDomain(domain));
  const inspect = (url: URL) => readPage(url, send, signal, dns);
  const [landing, llms, txt, https, aid] = await Promise.allSettled([
    inspect(home),
    inspect(new URL('/llms.txt', home)),
    lookup('_mcp.' + home.hostname, 'TXT', send, signal),
    lookup(home.hostname, 'HTTPS', send, signal),
    lookup('_agent.' + home.hostname, 'SVCB', send, signal),
  ]);
  const evidence: Evidence = {};
  const unknown: CheckId[] = [];
  const discovery =
    txt.status === 'fulfilled'
      ? txt.value.map((item) => mcpDiscoveryUrl(item.data)).find(Boolean)
      : null;
  if (discovery) evidence.mcp = 'A valid _mcp discovery record was found.';
  else if (txt.status === 'rejected') unknown.push('mcp');
  const httpsRecord =
    https.status === 'fulfilled' &&
    https.value.some((item) => /^\d+\s+\S+/.test(item.data));
  const svcRecord =
    aid.status === 'fulfilled' &&
    aid.value.some((item) => /^\d+\s+\S+/.test(item.data));
  if (discovery || httpsRecord || svcRecord)
    evidence.dns = 'A parseable public discovery record was found.';
  else if ([txt, https, aid].some((result) => result.status === 'rejected'))
    unknown.push('dns');

  const page = landing.status === 'fulfilled' ? landing.value : null;
  if (
    llms.status === 'fulfilled' &&
    llms.value &&
    /^text\/(plain|markdown)/i.test(llms.value.type) &&
    /^#\s+\S.+/m.test(llms.value.text)
  )
    evidence.llms = 'Found a readable /llms.txt file.';
  else if (page) {
    const equivalent = (page.text.match(/<link\b[^>]*>/gi) ?? []).find((tag) =>
      /\b(?:llms-txt|agent-discovery)\b/i.test(attr(tag, 'rel')),
    );
    try {
      const document =
        equivalent &&
        (await inspect(new URL(attr(equivalent, 'href'), page.url)));
      if (
        document &&
        /^text\/(plain|markdown)/i.test(document.type) &&
        /^#\s+\S.+/m.test(document.text)
      )
        evidence.llms = 'Found a linked agent discovery file.';
    } catch {
      unknown.push('llms');
    }
  }
  if (!evidence.llms && llms.status === 'rejected') unknown.push('llms');

  if (page) {
    const payloads = [
      ...page.text.matchAll(
        /<script\b([^>]*)>([\s\S]*?)<\/script(?=[\s/>])[^>]*>/gi,
      ),
    ]
      .filter(
        (match) =>
          attr('<script ' + match[1], 'type').toLowerCase() ===
          'application/ld+json',
      )
      .map((match) => parseJson(match[2]));
    const structuredSale = payloads
      .flatMap((data) => objects(data))
      .some(
        (item) => item.additionalType === 'DomainName' && item.forSale === true,
      );
    const visible = page.text
      .replace(
        /<(script|style|template)\b[^>]*>[\s\S]*?<\/\1(?=[\s/>])[^>]*>/gi,
        ' ',
      )
      .replace(/<!--[^]*?-->|<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ');
    if (
      structuredSale ||
      /(?:domain (?:name )?(?:is )?for sale|buy this domain|domain inquiries|make an offer on this domain)/i.test(
        visible,
      )
    )
      evidence.lander =
        'The public landing page advertises a domain transaction.';
    if (evidence.lander && payloads.some(structuredPrice))
      evidence.structuredPrice =
        'The lander publishes a structured asking amount and currency.';
    if (
      evidence.lander &&
      /<(?:form|a)\b[^>]*(?:action|href)\s*=\s*["'][^"']*(?:\/inquiries|\/offers|\/checkout|\/provider|\/broker)(?:[/?#"']|$)/i.test(
        page.text,
      )
    )
      evidence.completion =
        'The lander advertises a transaction or inquiry route.';
    const endpoint = pricingUrl(page);
    if (endpoint) {
      try {
        const result = await inspect(endpoint);
        if (
          result &&
          /^application\/(?:[^;]+\+)?json/i.test(result.type) &&
          structuredPrice(parseJson(result.text))
        ) {
          evidence.anonymousPrice =
            'The advertised JSON endpoint returned a price without credentials.';
          evidence.structuredPrice ??=
            'The JSON listing contains an asking amount and currency.';
        }
      } catch {
        unknown.push('anonymousPrice');
      }
    }
  } else {
    unknown.push('lander', 'structuredPrice', 'anonymousPrice', 'completion');
  }
  return { domain: home.hostname, ...scoreReadiness(evidence, unknown) };
}
