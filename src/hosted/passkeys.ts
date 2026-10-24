import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
} from '../../hosted/webauthn';
import { opaqueToken, tokenHash } from './crypto';
import type { SessionUser } from './accounts';

interface KeyRow {
  id: string;
  user_id: string;
  public_key: string;
  counter: number;
  transports: string;
  created_at: number;
  revision: string;
}
interface Challenge {
  id: string;
  challenge: string;
  kind: 'register' | 'login' | 'reauth';
  user_id: string | null;
  session_hash: string | null;
  credential_hash: string | null;
}
const origin = 'https://domains.domains',
  rpID = 'domains.domains';
export class Passkeys {
  constructor(private readonly env: HostedEnv) {}
  async list(user: SessionUser) {
    const rows = (
      await this.env.CONTROL_DB.prepare(
        'SELECT id,created_at,last_used_at,transports FROM passkeys WHERE user_id=?1 ORDER BY created_at,id',
      )
        .bind(user.id)
        .all<{
          id: string;
          created_at: number;
          last_used_at: number | null;
          transports: string;
        }>()
    ).results;
    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        created_at: row.created_at,
        last_used_at: row.last_used_at,
        reference: (await tokenHash(row.id)).slice(0, 12),
        // Transport describes authenticator capabilities, not a physical device.
        authenticator: row.transports.includes('internal')
          ? 'Built-in or synced authenticator'
          : row.transports.includes('usb') || row.transports.includes('nfc')
            ? 'USB / NFC security key'
            : row.transports.includes('hybrid')
              ? 'Cross-device authenticator'
              : 'Authenticator',
      })),
    );
  }
  async fresh(user: SessionUser) {
    const hasKeys = Boolean(
      await this.env.CONTROL_DB.prepare(
        'SELECT id FROM passkeys WHERE user_id=?1 LIMIT 1',
      )
        .bind(user.id)
        .first(),
    );
    return Boolean(
      user.authenticated_at &&
      user.authenticated_at > Date.now() - 300_000 &&
      user.authenticated_at <= Date.now() &&
      (!hasKeys || user.auth_method === 'passkey'),
    );
  }
  async options(
    kind: Challenge['kind'],
    user?: SessionUser,
    session?: string,
    next = '/app',
  ) {
    if (this.env.CANONICAL_ORIGIN !== origin)
      throw new Error('Passkeys unavailable on this origin');
    if (kind !== 'login' && (!user || !session))
      throw new Error('Sign in first');
    if (
      kind === 'register' &&
      (!(await this.fresh(user!)) || (await this.list(user!)).length >= 10)
    )
      throw new Error(
        'Confirm your identity before adding a passkey (maximum ten)',
      );
    const db = this.env.CONTROL_DB;
    const keys = user
      ? (
          await db
            .prepare('SELECT * FROM passkeys WHERE user_id=?1')
            .bind(user.id)
            .all<KeyRow>()
        ).results
      : [];
    const descriptors = keys.map((k) => ({
      id: k.id,
      transports: JSON.parse(k.transports) as AuthenticatorTransport[],
    }));
    const options =
      kind === 'register'
        ? await generateRegistrationOptions({
            rpName: 'domains.domains',
            rpID,
            userName: user!.email,
            userID: new TextEncoder().encode(user!.id),
            attestationType: 'none',
            authenticatorSelection: {
              residentKey: 'required',
              userVerification: 'required',
            },
            excludeCredentials: descriptors,
            supportedAlgorithmIDs: [-7, -257],
          })
        : await generateAuthenticationOptions({
            rpID,
            userVerification: 'required',
            ...(user ? { allowCredentials: descriptors } : {}),
          });
    const id = opaqueToken();
    const credential = user
      ? await db
          .prepare('SELECT password_hash FROM users WHERE id=?1')
          .bind(user.id)
          .first<{ password_hash: string }>()
      : null;
    await db
      .prepare(
        'INSERT INTO webauthn_challenges(id,challenge,kind,user_id,session_hash,credential_hash,expires_at,next_path) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)',
      )
      .bind(
        id,
        options.challenge,
        kind,
        user?.id ?? null,
        kind !== 'login' && session ? await tokenHash(session) : null,
        credential?.password_hash ?? null,
        Date.now() + 300_000,
        kind === 'register' ? '/account' : next,
      )
      .run();
    return { id, options };
  }
  async verify(
    id: string,
    response: RegistrationResponseJSON | AuthenticationResponseJSON,
    user?: SessionUser,
    session?: string,
  ): Promise<string | null> {
    if (!/^[a-f0-9]{64}$/.test(id) || this.env.CANONICAL_ORIGIN !== origin)
      return null;
    const db = this.env.CONTROL_DB,
      now = Date.now(),
      sessionHash = session ? await tokenHash(session) : null;
    const challenge = await db
      .prepare(
        'SELECT * FROM webauthn_challenges WHERE id=?1 AND expires_at>?2 AND consumed_at IS NULL',
      )
      .bind(id, now)
      .first<Challenge>();
    if (
      !challenge ||
      (challenge.kind !== 'login' &&
        (!user ||
          challenge.user_id !== user.id ||
          challenge.session_hash !== sessionHash))
    )
      return null;
    const consumption = opaqueToken(),
      token = opaqueToken(),
      hash = await tokenHash(token);
    let owner: string,
      credentialHash: string,
      key: KeyRow | undefined,
      nextCounter = 0;
    const statements: D1PreparedStatement[] = [];
    try {
      if (challenge.kind === 'register') {
        if (!(await this.fresh(user!))) return null;
        const verified = await verifyRegistrationResponse({
          response: response as RegistrationResponseJSON,
          expectedChallenge: challenge.challenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          requireUserVerification: true,
          supportedAlgorithmIDs: [-7, -257],
        });
        if (!verified.verified || !verified.registrationInfo.userVerified)
          return null;
        const c = verified.registrationInfo.credential;
        owner = user!.id;
        credentialHash = challenge.credential_hash!;
        // First enrollment can use fresh email/password. Once a key exists,
        // another enrollment must be authorized by a fresh existing passkey.
        statements.push(
          db
            .prepare(
              "UPDATE webauthn_challenges SET consumed_at=?1,consumption_id=?2 WHERE id=?3 AND consumed_at IS NULL AND expires_at>?1 AND EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id JOIN workspaces w ON w.id=u.workspace_id WHERE s.token_hash=?4 AND s.user_id=?5 AND s.expires_at>?1 AND s.authenticated_at>?6 AND u.password_hash=?7 AND w.enabled=1 AND (s.auth_method='passkey' OR NOT EXISTS(SELECT 1 FROM passkeys WHERE user_id=u.id))) AND (SELECT count(*) FROM passkeys WHERE user_id=?5)<10 RETURNING id",
            )
            .bind(
              now,
              consumption,
              id,
              sessionHash,
              owner,
              now - 300_000,
              credentialHash,
            ),
        );
        statements.push(
          db
            .prepare(
              'INSERT INTO passkeys(id,user_id,public_key,counter,transports,created_at,revision) SELECT ?1,?2,?3,?4,?5,?6,?7 WHERE EXISTS(SELECT 1 FROM webauthn_challenges WHERE consumption_id=?8)',
            )
            .bind(
              c.id,
              owner,
              Buffer.from(c.publicKey).toString('base64url'),
              c.counter,
              JSON.stringify(c.transports ?? []),
              now,
              opaqueToken(),
              consumption,
            ),
        );
      } else {
        key =
          (await db
            .prepare('SELECT * FROM passkeys WHERE id=?1')
            .bind(response.id)
            .first<KeyRow>()) ?? undefined;
        if (!key || (challenge.user_id && key.user_id !== challenge.user_id))
          return null;
        const authResponse = response as AuthenticationResponseJSON;
        if (
          authResponse.response.userHandle &&
          authResponse.response.userHandle !==
            Buffer.from(key.user_id).toString('base64url')
        )
          return null;
        const verified = await verifyAuthenticationResponse({
          response: authResponse,
          expectedChallenge: challenge.challenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          requireUserVerification: true,
          credential: {
            id: key.id,
            publicKey: new Uint8Array(Buffer.from(key.public_key, 'base64url')),
            counter: key.counter,
            transports: JSON.parse(key.transports),
          },
        });
        if (!verified.verified || !verified.authenticationInfo.userVerified)
          return null;
        owner = key.user_id;
        nextCounter = verified.authenticationInfo.newCounter;
        const row = await db
          .prepare('SELECT password_hash FROM users WHERE id=?1')
          .bind(owner)
          .first<{ password_hash: string }>();
        if (
          !row ||
          (challenge.credential_hash &&
            challenge.credential_hash !== row.password_hash)
        )
          return null;
        credentialHash = row.password_hash;
        statements.push(
          db
            .prepare(
              'UPDATE webauthn_challenges SET consumed_at=?1,consumption_id=?2 WHERE id=?3 AND consumed_at IS NULL AND expires_at>?1 AND EXISTS(SELECT 1 FROM passkeys k JOIN users u ON u.id=k.user_id JOIN workspaces w ON w.id=u.workspace_id WHERE k.id=?4 AND k.revision=?5 AND u.password_hash=?6 AND w.enabled=1) AND (?7 IS NULL OR EXISTS(SELECT 1 FROM sessions WHERE token_hash=?7 AND user_id=?8 AND expires_at>?1)) RETURNING id',
            )
            .bind(
              now,
              consumption,
              id,
              key.id,
              key.revision,
              credentialHash,
              challenge.session_hash,
              owner,
            ),
        );
        statements.push(
          db
            .prepare(
              'UPDATE passkeys SET counter=?1,last_used_at=?2,revision=?3 WHERE id=?4 AND revision=?5 AND EXISTS(SELECT 1 FROM webauthn_challenges WHERE consumption_id=?6)',
            )
            .bind(
              nextCounter,
              now,
              opaqueToken(),
              key.id,
              key.revision,
              consumption,
            ),
        );
      }
      statements.push(
        db
          .prepare(
            "INSERT INTO sessions(token_hash,user_id,expires_at,authenticated_at,auth_method) SELECT ?1,u.id,?2,?3,'passkey' FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE u.id=?4 AND u.password_hash=?5 AND w.enabled=1 AND EXISTS(SELECT 1 FROM webauthn_challenges WHERE consumption_id=?6) RETURNING user_id",
          )
          .bind(
            hash,
            now + 7 * 86400_000,
            now,
            owner,
            credentialHash,
            consumption,
          ),
      );
      if (challenge.session_hash)
        statements.push(
          db
            .prepare(
              'DELETE FROM sessions WHERE token_hash=?1 AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=?2)',
            )
            .bind(challenge.session_hash, hash),
        );
      const result = await db.batch(statements);
      return result[0].results.length &&
        result[result.length - (challenge.session_hash ? 2 : 1)].results.length
        ? token
        : null;
    } catch {
      return null;
    }
  }
  async remove(user: SessionUser, id: string, session: string) {
    if (!(await this.fresh(user))) return false;
    const hash = await tokenHash(session);
    const result = await this.env.CONTROL_DB.batch([
      this.env.CONTROL_DB.prepare(
        "DELETE FROM passkeys WHERE id=?1 AND user_id=?2 AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=?3 AND user_id=?2 AND expires_at>?4 AND authenticated_at>?5 AND auth_method='passkey') RETURNING id",
      ).bind(id, user.id, hash, Date.now(), Date.now() - 300_000),
      this.env.CONTROL_DB.prepare(
        'DELETE FROM sessions WHERE user_id=?1 AND token_hash<>?2 AND changes()>0',
      ).bind(user.id, hash),
    ]);
    return result[0].results.length === 1;
  }
}
