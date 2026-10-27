import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { opaqueToken, tokenHash } from './crypto';
import { Accounts, type SessionUser } from './accounts';
import {
  registrationIds,
  registrationPool,
  registrationPoolIds,
  registrationReady,
  sendAuthEmail,
  reserveAuthEmail,
} from './registration';
import { legalVersion } from './legal';
import { escapeHtml } from './views';
import { salesRecipientHash } from './sales-notifications';

interface EmailProof {
  id: string;
  email: string;
  user_id: string | null;
  credential_hash: string | null;
  intent: 'login' | 'reauth';
  session_hash: string | null;
  next_path: string;
  token_hash: string;
  code_hash: string;
}
export class TermsAcceptanceRequired extends Error {
  constructor(readonly email: string) {
    super(
      'Accept the Terms and acknowledge the Privacy Policy to create your account.',
    );
  }
}
export class EmailAuth {
  constructor(private readonly env: HostedEnv) {}
  private codeHash(id: string, code: string) {
    if (this.env.AUTH_PEPPER.length < 32)
      throw new Error('Authentication unavailable');
    return createHmac('sha256', this.env.AUTH_PEPPER)
      .update(`email-code:${id}:${code}`)
      .digest('hex');
  }
  async issue(
    email: string,
    next: string,
    user?: SessionUser,
    session?: string,
    waitUntil?: (promise: Promise<unknown>) => void,
  ) {
    // A service-wide capacity result must be identical for known/unknown emails.
    await reserveAuthEmail(this.env);
    const db = this.env.CONTROL_DB,
      id = opaqueToken(),
      token = opaqueToken();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const row = await db
      .prepare(
        'SELECT u.id,u.password_hash FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE u.email=?1 AND w.enabled=1',
      )
      .bind(email)
      .first<{ id: string; password_hash: string }>();
    // A fake, indistinguishable challenge keeps account enumeration out of the
    // response. Disabled accounts and an unqualified signup never receive mail.
    const anyUser = await db
      .prepare('SELECT id FROM users WHERE email=?1')
      .bind(email)
      .first();
    if (
      (user && row?.id !== user.id) ||
      (!row && (anyUser || !registrationReady(this.env)))
    )
      return id;
    const intent = user ? 'reauth' : 'login';
    const inserted = await db.batch([
      db
        .prepare('DELETE FROM email_signins WHERE email=?1 AND intent=?2')
        .bind(email, intent),
      db
        .prepare(
          'INSERT INTO email_signins(id,token_hash,code_hash,email,user_id,credential_hash,intent,session_hash,next_path,expires_at) SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10 WHERE (SELECT count(*) FROM email_signins WHERE consumed_at IS NULL AND expires_at>?11)<5000 RETURNING id',
        )
        .bind(
          id,
          await tokenHash(token),
          this.codeHash(id, code),
          email,
          row?.id ?? null,
          row?.password_hash ?? null,
          intent,
          user && session ? await tokenHash(session) : null,
          next,
          Date.now() + 600_000,
          Date.now(),
        ),
    ]);
    if (!inserted[1].results.length) return id;
    const url = new URL('/auth/email/confirm', this.env.CANONICAL_ORIGIN);
    url.searchParams.set('id', id);
    url.searchParams.set('token', token);
    const intro = user
      ? 'Confirm it’s you to continue on domains.domains.'
      : 'Sign in or create your domains.domains account.';
    const delivery = sendAuthEmail(
      this.env,
      email,
      {
        subject: user
          ? 'Confirm your domains.domains sign-in'
          : 'Your domains.domains sign-in link and code',
        text: `${intro}\n\n${url.href}\n\nOr enter this six-digit code in the browser where you requested it: ${code}\n\nThe link and code expire in 10 minutes. Using either invalidates both. Do not share or forward this email. If you did not request this, ignore it.\n\ndomains.domains`,
        html: `<p>${intro}</p><p><a href="${escapeHtml(url.href)}">Continue to domains.domains</a></p><p>Or enter this six-digit code in your original browser: <strong>${code}</strong></p><p>Expires in 10 minutes. Using the link or code invalidates both. Never share or forward this email. If you did not request this, ignore it.</p>`,
      },
      true,
    ).then(async (sent) => {
      // Failed sends must not leave a usable proof; responses still match unknown
      // accounts. The durable email budget remains charged on provider failures.
      if (!sent)
        await db
          .prepare('DELETE FROM email_signins WHERE id=?1')
          .bind(id)
          .run();
    });
    // Provider work runs outside the response path to avoid SMTP timing leaks.
    if (waitUntil) waitUntil(delivery);
    else await delivery;
    return id;
  }
  async peek(id: string, token: string): Promise<EmailProof | null> {
    if (!/^[a-f0-9]{64}$/.test(id) || !/^[a-f0-9]{64}$/.test(token))
      return null;
    return this.env.CONTROL_DB.prepare(
      'SELECT * FROM email_signins WHERE id=?1 AND token_hash=?2 AND consumed_at IS NULL AND attempts<5 AND expires_at>?3',
    )
      .bind(id, await tokenHash(token), Date.now())
      .first<EmailProof>();
  }
  async consume(
    id: string,
    proof: string,
    link: boolean,
    accept: boolean,
    session?: string,
  ): Promise<{ token: string; next: string } | null> {
    if (
      !/^[a-f0-9]{64}$/.test(id) ||
      !(link ? /^[a-f0-9]{64}$/ : /^\d{6}$/).test(proof)
    )
      return null;
    const db = this.env.CONTROL_DB,
      now = Date.now();
    const row = await db
      .prepare(
        'UPDATE email_signins SET attempts=attempts+1 WHERE id=?1 AND consumed_at IS NULL AND attempts<5 AND expires_at>?2 RETURNING *',
      )
      .bind(id, now)
      .first<EmailProof>();
    if (!row) return null;
    const actual = link ? await tokenHash(proof) : this.codeHash(id, proof),
      expected = link ? row.token_hash : row.code_hash;
    if (!timingSafeEqual(Buffer.from(actual), Buffer.from(expected)))
      return null;
    const sessionHash = session ? await tokenHash(session) : null;
    if (
      row.intent === 'reauth' &&
      (!sessionHash || row.session_hash !== sessionHash)
    )
      return null;
    if (!row.user_id && !accept) {
      // The proof was correct. Reviewing signup terms is not another guess;
      // keep the last remaining attempt usable for the acceptance submission.
      await db
        .prepare(
          'UPDATE email_signins SET attempts=attempts-1 WHERE id=?1 AND consumed_at IS NULL AND attempts>0',
        )
        .bind(id)
        .run();
      throw new TermsAcceptanceRequired(row.email);
    }
    if (!row.user_id && !registrationReady(this.env)) return null;
    if (
      row.intent === 'reauth' &&
      (await db
        .prepare('SELECT id FROM passkeys WHERE user_id=?1 LIMIT 1')
        .bind(row.user_id)
        .first())
    )
      return null;
    const consumption = opaqueToken(),
      token = opaqueToken(),
      newId = crypto.randomUUID(),
      encoded = `email-only-v1:${opaqueToken()}`;
    const statements = [
      db
        .prepare(
          'UPDATE email_signins SET consumed_at=?1,consumption_id=?2 WHERE id=?3 AND consumed_at IS NULL AND expires_at>?1 AND (user_id IS NULL OR EXISTS(SELECT 1 FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE u.id=email_signins.user_id AND u.password_hash=email_signins.credential_hash AND w.enabled=1)) RETURNING id',
        )
        .bind(now, consumption, id),
    ];
    if (!row.user_id) {
      const ids = registrationIds(this.env);
      if (!ids.length) return null;
      statements.push(
        db
          .prepare(
            `INSERT INTO users(id,email,workspace_id,password_hash,created_at) SELECT ?1,p.email,w.id,?2,?3 FROM email_signins p CROSS JOIN workspaces w WHERE p.consumption_id=?4 AND ${registrationPool(ids, 5)} AND w.enabled=1 AND NOT EXISTS(SELECT 1 FROM users u WHERE u.workspace_id=w.id OR u.email=p.email) AND NOT EXISTS(SELECT 1 FROM invitations i WHERE i.workspace_id=w.id) AND NOT EXISTS(SELECT 1 FROM closure_requests r WHERE r.workspace_id=w.id) ORDER BY w.id LIMIT 1`,
          )
          .bind(newId, encoded, now, consumption, registrationPoolIds(ids)),
      );
      statements.push(
        db
          .prepare(
            'INSERT INTO legal_acceptances(user_id,terms_version,privacy_version,accepted_at) SELECT id,?2,?2,?3 FROM users WHERE id=?1 AND EXISTS(SELECT 1 FROM email_signins WHERE consumption_id=?4)',
          )
          .bind(newId, legalVersion, now, consumption),
      );
    }
    const sessionStatementIndex = statements.length;
    if (row.intent === 'reauth') {
      // Rotate the browser token after fresh authentication; never revive an
      // expired/revoked session or grant an email downgrade after passkey setup.
      statements.push(
        db
          .prepare(
            "INSERT INTO sessions(token_hash,user_id,expires_at,authenticated_at,auth_method) SELECT ?1,s.user_id,s.expires_at,?2,'email' FROM sessions s JOIN email_signins p ON p.user_id=s.user_id WHERE s.token_hash=?3 AND s.expires_at>?2 AND p.consumption_id=?4 AND NOT EXISTS(SELECT 1 FROM passkeys WHERE user_id=s.user_id) RETURNING user_id",
          )
          .bind(await tokenHash(token), now, sessionHash, consumption),
      );
      statements.push(
        db
          .prepare(
            'DELETE FROM sessions WHERE token_hash=?1 AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=?2)',
          )
          .bind(sessionHash, await tokenHash(token)),
      );
    } else {
      statements.push(
        db
          .prepare(
            "INSERT INTO sessions(token_hash,user_id,expires_at,authenticated_at,auth_method) SELECT ?1,u.id,?2,?3,'email' FROM users u JOIN workspaces w ON w.id=u.workspace_id JOIN email_signins p ON (p.user_id=u.id OR (p.user_id IS NULL AND u.id=?4)) WHERE p.consumption_id=?5 AND w.enabled=1 RETURNING user_id",
          )
          .bind(
            await tokenHash(token),
            now + 7 * 86400_000,
            now,
            newId,
            consumption,
          ),
      );
    }
    try {
      const results = await db.batch(statements);
      // The guarded INSERT is the transaction's session receipt. A separate
      // read can fail after commit, stranding a consumed proof without a cookie.
      if (
        !results[0].results.length ||
        results[sessionStatementIndex].results.length !== 1
      )
        return null;
      if (this.env.SALES_MAIL_ENABLED === 'true') {
        // Sales metadata must never make an otherwise valid auth proof fail.
        try {
          const verifiedUser = await new Accounts(
            db,
            this.env.AUTH_PEPPER,
          ).session(token);
          if (verifiedUser)
            await db
              .prepare(
                'INSERT INTO sales_verified_recipients(workspace_id,email_hash,verified_at) VALUES(?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET email_hash=excluded.email_hash,verified_at=excluded.verified_at',
              )
              .bind(
                verifiedUser.workspace_id,
                salesRecipientHash(this.env, verifiedUser.email),
                now,
              )
              .run();
        } catch {
          /* Keep auth independent; the seller can verify again. */
        }
      }
      return { token, next: row.next_path };
    } catch {
      return null;
    }
  }
}
