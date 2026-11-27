import { timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import { boundedText } from '../agent-readiness/scan';
import { saleDomainSchema, saleMoneySchema } from '../shared/hosted-sales';
import { agentCatalogEnabled, readAgentListing } from './agent-catalog';
import { catalogHeaders } from './agent-projection';

const referralAudience = 'domains-agent-referral';
const encoder = new TextEncoder();
const id = z.uuid();
const partnerId = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
const grantSchema = z.object({
  workspace: id,
  domain: saleDomainSchema,
  listing: id,
  revision: id,
  partner: partnerId,
  grant: id,
});
export type AgentReferralGrant = z.output<typeof grantSchema>;

export function referralPartner(env: HostedEnv) {
  const partner = partnerId.safeParse(env.AGENT_REFERRAL_PARTNER_ID);
  const name = z
    .string()
    .trim()
    .min(1)
    .max(80)
    .safeParse(env.AGENT_REFERRAL_PARTNER_NAME);
  const token = env.AGENT_REFERRAL_PARTNER_TOKEN;
  const key = env.AGENT_REFERRAL_SIGNING_KEY;
  if (
    !agentCatalogEnabled(env) ||
    !partner.success ||
    !name.success ||
    !token ||
    token.length < 32 ||
    !key ||
    key.length < 32 ||
    key === token
  )
    return null;
  return { id: partner.data, name: name.data, token, key: encoder.encode(key) };
}

const reject = (status: number, message: string) =>
  Response.json({ error: message }, { status, headers: catalogHeaders });

function eligible(live: Awaited<ReturnType<typeof readAgentListing>>) {
  return live?.listing.route?.type === 'offer' && !!live.listing.askingPrice;
}

export async function saveReferralConsent(
  env: HostedEnv,
  workspace: string,
  entry: {
    domain: string;
    listing: string;
    revision: string;
    enabled: boolean;
  },
) {
  const partner = referralPartner(env);
  if (!partner) return false;
  if (!entry.enabled) {
    await env.CONTROL_DB.prepare(
      'DELETE FROM agent_referral_optins WHERE workspace_id=? AND listing_id=? AND domain=? AND partner_id=?',
    )
      .bind(workspace, entry.listing, entry.domain, partner.id)
      .run();
    return true;
  }
  const live = await readAgentListing(env, entry.domain, { owner: workspace });
  if (
    !live ||
    !eligible(live) ||
    live.route.listing_id !== entry.listing ||
    live.listing.revision !== entry.revision
  )
    return false;
  const created = await env.CONTROL_DB.prepare(
    `INSERT INTO agent_referral_optins(workspace_id,domain,listing_id,revision,partner_id,grant_id,opted_in_at)
      SELECT workspace_id,domain,listing_id,revision,?1,?2,?3 FROM public_domain_routes
      WHERE workspace_id=?4 AND domain=?5 AND listing_id=?6 AND revision=?7 AND state IN ('active','reserved')
      ON CONFLICT(workspace_id,listing_id,partner_id) DO UPDATE SET
        revision=excluded.revision,grant_id=excluded.grant_id,opted_in_at=excluded.opted_in_at
      WHERE agent_referral_optins.revision!=excluded.revision`,
  )
    .bind(
      partner.id,
      crypto.randomUUID(),
      Date.now(),
      workspace,
      entry.domain,
      entry.listing,
      entry.revision,
    )
    .run();
  if (created.meta.changes) return true;
  return !!(await env.CONTROL_DB.prepare(
    'SELECT 1 FROM agent_referral_optins WHERE workspace_id=? AND listing_id=? AND partner_id=? AND revision=?',
  )
    .bind(workspace, entry.listing, partner.id, entry.revision)
    .first());
}

export async function partnerListings(env: HostedEnv, request: Request) {
  const partner = referralPartner(env);
  if (!partner) return reject(404, 'Referral feed unavailable.');
  const known = encoder.encode('Bearer ' + partner.token);
  const supplied = encoder.encode(request.headers.get('Authorization') ?? '');
  if (known.length !== supplied.length || !timingSafeEqual(known, supplied))
    return reject(401, 'Partner authentication required.');
  const rawCursor = new URL(request.url).searchParams.get('cursor');
  const cursor =
    rawCursor === null ? '' : saleDomainSchema.safeParse(rawCursor);
  if (cursor && !cursor.success) return reject(400, 'Invalid listing cursor.');
  const { results } = await env.CONTROL_DB.prepare(
    `SELECT p.workspace_id AS workspace,p.domain,p.listing_id AS listing,p.revision,
       p.partner_id AS partner,p.grant_id AS grant
     FROM agent_referral_optins p JOIN public_domain_routes r ON r.domain=p.domain
     WHERE p.partner_id=? AND r.workspace_id=p.workspace_id AND r.listing_id=p.listing_id
       AND r.revision=p.revision AND r.state IN ('active','reserved') AND p.domain>?
     ORDER BY p.domain LIMIT 13`,
  )
    .bind(partner.id, cursor ? cursor.data : '')
    .all<AgentReferralGrant>();
  const page = results.slice(0, 12);
  const listings = [];
  for (const grant of page) {
    const live = await readAgentListing(env, grant.domain, {
      owner: grant.workspace,
    });
    if (
      !live ||
      !eligible(live) ||
      live.route.listing_id !== grant.listing ||
      live.listing.revision !== grant.revision
    )
      continue;
    const ticket = await new SignJWT({
      grant: grant.grant,
      domain: grant.domain,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience(referralAudience)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(partner.key);
    const url = new URL(live.listing.urls.listing);
    url.searchParams.set('referral', ticket);
    listings.push({
      domain: live.listing.domain,
      askingPrice: live.listing.askingPrice,
      lastVerified: live.listing.lastVerified,
      priceValidUntil: live.listing.priceValidUntil,
      offerUrl: url.href,
    });
  }
  return Response.json(
    {
      listings,
      nextCursor: results.length > page.length ? page.at(-1)!.domain : null,
    },
    { headers: catalogHeaders },
  );
}

export async function verifyReferral(
  env: HostedEnv,
  raw: string,
  domain: string,
) {
  const partner = referralPartner(env);
  if (!partner || raw.length > 2048) return null;
  let ticket: { grant: string; domain: string };
  try {
    const verified = await jwtVerify(raw, partner.key, {
      algorithms: ['HS256'],
      audience: referralAudience,
      requiredClaims: ['iat', 'exp'],
      maxTokenAge: '1h',
    });
    ticket = grantSchema
      .pick({ grant: true, domain: true })
      .parse(verified.payload);
  } catch {
    return null;
  }
  if (ticket.domain !== domain) return null;
  const grant = await env.CONTROL_DB.prepare(
    'SELECT workspace_id AS workspace,domain,listing_id AS listing,revision,partner_id AS partner,grant_id AS grant FROM agent_referral_optins WHERE domain=? AND partner_id=? AND grant_id=?',
  )
    .bind(domain, partner.id, ticket.grant)
    .first<AgentReferralGrant>();
  if (!grant) return null;
  const live = await readAgentListing(env, domain, { owner: grant.workspace });
  return live &&
    eligible(live) &&
    live.route.listing_id === grant.listing &&
    live.listing.revision === grant.revision
    ? { grant, partnerName: partner.name }
    : null;
}

export async function bindReferralOffer(
  request: Request,
  grant: AgentReferralGrant,
) {
  const form = await request.formData().catch(() => null);
  const key = id.safeParse(form?.get('idempotencyKey'));
  const price = saleMoneySchema.safeParse({
    amount: form?.get('amount'),
    currency: form?.get('currency'),
  });
  if (
    !form ||
    !key.success ||
    !price.success ||
    form.get('observedRevision') !== grant.revision ||
    form.get('intent') !== 'offer'
  )
    return null;
  // Bind retries to this verified partner grant, independently of a direct offer.
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      encoder.encode(grant.grant + ':' + key.data),
    ),
  );
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = Array.from(digest.slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  form.set(
    'idempotencyKey',
    [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join('-'),
  );
  const headers = new Headers(request.headers);
  headers.delete('Content-Type');
  headers.delete('Content-Length');
  return new Request(request.url, {
    method: request.method,
    headers,
    body: form,
    redirect: 'manual',
  });
}

export async function recordReferral(
  env: HostedEnv,
  referral: { grant: AgentReferralGrant; partnerName: string },
  response: Response,
) {
  if (response.status !== 202) return;
  const receipt = id.safeParse(
    (await boundedText(response, 65536)).match(
      /<p class="receipt">Inquiry reference: ([a-f0-9-]{36})<\/p>/i,
    )?.[1],
  );
  if (!receipt.success) throw new Error('Missing Sales receipt for referral.');
  const { grant } = referral;
  await env.CONTROL_DB.prepare(
    `INSERT INTO agent_referral_receipts(workspace_id,receipt,domain,listing_id,revision,partner_id,partner_name,created_at)
     VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,receipt) DO NOTHING`,
  )
    .bind(
      grant.workspace,
      receipt.data,
      grant.domain,
      grant.listing,
      grant.revision,
      grant.partner,
      referral.partnerName,
      Date.now(),
    )
    .run();
}

export async function ownerReferralActivity(env: HostedEnv, workspace: string) {
  const partner = referralPartner(env);
  if (!partner) return null;
  const [grants, recent] = await Promise.all([
    env.CONTROL_DB.prepare(
      'SELECT listing_id,revision FROM agent_referral_optins WHERE workspace_id=? AND partner_id=?',
    )
      .bind(workspace, partner.id)
      .all<{ listing_id: string; revision: string }>(),
    env.CONTROL_DB.prepare(
      'SELECT domain,receipt,partner_name FROM agent_referral_receipts WHERE workspace_id=? ORDER BY created_at DESC LIMIT 10',
    )
      .bind(workspace)
      .all<{ domain: string; receipt: string; partner_name: string }>(),
  ]);
  return {
    partnerName: partner.name,
    approvals: new Map(
      grants.results.map((row) => [row.listing_id, row.revision]),
    ),
    recent: recent.results,
  };
}

export async function pruneReferralActivity(env: HostedEnv) {
  if (!referralPartner(env)) return;
  await env.CONTROL_DB.prepare(
    'DELETE FROM agent_referral_receipts WHERE rowid IN (SELECT rowid FROM agent_referral_receipts WHERE created_at<? LIMIT 200)',
  )
    .bind(Date.now() - 365 * 86400_000)
    .run();
}
