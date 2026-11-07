import { parkioMobileConnection } from './parkio-mobile-contract';
import {
  parkioNativeLogin,
  parkioNativeVerification,
  parkioNativeSnapshot,
  type ParkioNativeSnapshot,
} from './parkio-native-contract';

const root = document.getElementById('parkio-native');
if (root) setup(root);
function setup(root: HTMLElement) {
  const base = '/admin/parkio-pilot';
  const username = root.querySelector<HTMLInputElement>('#native-username')!;
  const password = root.querySelector<HTMLInputElement>('#native-password')!;
  const code = root.querySelector<HTMLInputElement>('#native-code')!;
  const status = root.querySelector<HTMLElement>('#native-status')!;
  let socket: WebSocket | null = null,
    nextId = 0,
    busy = false,
    alive = true,
    epoch = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attemptId: string | undefined;
  const pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const message = (value: string) => {
    status.textContent = value;
  };
  const panel = (name: string) => {
    root.querySelectorAll<HTMLElement>('[data-native-panel]').forEach((e) => {
      e.hidden = e.dataset.nativePanel !== name;
    });
  };
  const fail = (value: string) => {
    root.querySelector<HTMLElement>('#native-error')!.textContent = value;
    panel('error');
    message('');
  };
  const clearSecrets = () => {
    password.value = '';
    code.value = '';
    password.type = 'password';
    root.querySelector('#native-show')!.textContent = 'Show';
    root.querySelector('#native-show')!.setAttribute('aria-pressed', 'false');
  };
  function disconnect() {
    epoch++;
    socket?.close();
    socket = null;
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject();
    }
    pending.clear();
  }
  async function api<T>(path: string, method = 'POST'): Promise<T> {
    const response = await fetch(base + path, {
      method,
      credentials: 'same-origin',
      redirect: 'manual',
      headers: {
        Accept: 'application/json',
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: method === 'POST' ? '{}' : undefined,
      signal: AbortSignal.timeout(45000),
    });
    if (
      response.type === 'opaqueredirect' ||
      response.status === 303 ||
      response.status === 401
    )
      throw Error('account_authentication_required');
    const value = (await response.json()) as T & { error?: string };
    if (!response.ok)
      throw Error(
        value.error && /^[a-z_]{1,60}$/.test(value.error)
          ? value.error
          : 'proof_unavailable',
      );
    return value;
  }
  function send<T>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!alive || socket?.readyState !== WebSocket.OPEN) {
        reject(Error('connection_closed'));
        return;
      }
      const id = ++nextId,
        timer = setTimeout(() => {
          pending.delete(id);
          reject(Error('command_timed_out'));
        }, 10000);
      pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject: () => reject(Error('browser_command_failed')),
        timer,
      });
      try {
        socket.send(JSON.stringify({ id, method, params }));
      } catch {
        clearTimeout(timer);
        pending.delete(id);
        reject(Error('connection_closed'));
      }
    });
  }
  async function snapshot(): Promise<ParkioNativeSnapshot> {
    const r = await send<{
      result?: { value?: ParkioNativeSnapshot };
      exceptionDetails?: unknown;
    }>('Runtime.evaluate', {
      expression: parkioNativeSnapshot,
      returnByValue: true,
    });
    if (r.exceptionDetails || !r.result?.value)
      throw Error('provider_contract_required');
    return r.result.value;
  }
  async function call(declaration: string, args: string[]): Promise<void> {
    const global = await send<{ result: { objectId?: string } }>(
      'Runtime.evaluate',
      { expression: 'globalThis', returnByValue: false },
    );
    const objectId = global.result.objectId;
    if (!objectId) throw Error('provider_contract_required');
    try {
      const result = await send<{
        result?: { value?: { ok?: boolean } };
        exceptionDetails?: unknown;
      }>('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: declaration,
        arguments: args.map((value) => ({ value })),
        returnByValue: true,
      });
      if (result.exceptionDetails || result.result?.value?.ok !== true)
        throw Error('provider_contract_required');
    } finally {
      void send('Runtime.releaseObject', { objectId }).catch(() => {});
    }
  }
  async function connect(start: boolean) {
    if (socket?.readyState === WebSocket.OPEN) return;
    disconnect();
    const grant = await api<{
      viewerUrl: string;
      socketUrl: string;
      attemptId?: string;
    }>(start ? '/native-connection' : '/mobile-connection');
    if (grant.attemptId) attemptId = grant.attemptId;
    const checked = parkioMobileConnection({
      devtoolsFrontendUrl: grant.viewerUrl,
      webSocketDebuggerUrl: grant.socketUrl,
    });
    if (!alive) throw Error('connection_closed');
    const peer = new WebSocket(checked.socketUrl);
    socket = peer;
    peer.addEventListener('message', (event) => {
      if (socket !== peer) return;
      let value: { id?: number; error?: unknown; result?: unknown };
      try {
        value = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!value.id) return;
      const item = pending.get(value.id);
      if (!item) return;
      clearTimeout(item.timer);
      pending.delete(value.id);
      if (value.error) item.reject();
      else item.resolve(value.result);
    });
    peer.addEventListener('close', () => {
      if (socket === peer) disconnect();
    });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(Error('connection_timed_out')), 12000);
      peer.addEventListener(
        'open',
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
      peer.addEventListener(
        'error',
        () => {
          clearTimeout(t);
          reject(Error('connection_unavailable'));
        },
        { once: true },
      );
    });
  }
  async function showProof() {
    const proof = await api<{
      phase: string;
      browserClosed: boolean;
      checkedAt?: number;
      authenticationFlow?: string;
      holdings: { domain: string; expirationDate: string | null }[];
    }>('/native-proof', 'GET');
    if (
      proof.phase !== 'passed' ||
      !proof.browserClosed ||
      !Array.isArray(proof.holdings)
    )
      throw Error('proof_not_ready');
    clearSecrets();
    disconnect();
    root.querySelector<HTMLElement>('#native-summary')!.textContent =
      `${proof.holdings.length.toLocaleString()} domain${proof.holdings.length === 1 ? '' : 's'} verified. Initial background refresh passed. ${proof.authenticationFlow === 'native_credentials' ? 'Native credential submission verified.' : 'An existing sign-in was reused; native credential submission is not yet verified.'}`;
    const list = root.querySelector<HTMLElement>('#native-holdings')!;
    list.replaceChildren();
    for (const holding of proof.holdings.slice(0, 100)) {
      const row = document.createElement('div');
      row.className = 'native-row';
      const name = document.createElement('strong');
      name.textContent = holding.domain;
      const date = document.createElement('small');
      date.textContent = holding.expirationDate
        ? `Expires ${holding.expirationDate}`
        : 'Expiration date not supplied';
      row.append(name, date);
      list.append(row);
    }
    if (proof.holdings.length > 100) {
      const note = document.createElement('p');
      note.textContent = 'Showing the first 100 verified domains.';
      list.append(note);
    }
    panel('proved');
    message('Initial session portability proof passed.');
    const button = root.querySelector<HTMLButtonElement>('#native-retest')!;
    const delay = Math.max(0, (proof.checkedAt ?? 0) + 60000 - Date.now());
    button.disabled = delay > 0;
    root.querySelector<HTMLElement>('#native-retest-note')!.textContent = delay
      ? 'Another background check is available one minute after the last check.'
      : 'Up to three bounded background checks are available for this proof.';
    clearTimeout(timer);
    if (delay)
      timer = setTimeout(() => {
        if (alive) button.disabled = false;
      }, delay);
  }
  async function complete() {
    panel('working');
    root.querySelector<HTMLElement>('#native-heading')!.textContent =
      'Verifying your holdings…';
    root.querySelector<HTMLElement>('#native-progress')!.textContent =
      'Reading your domains and checking background refresh.';
    const result = await api<{ phase: string }>('/native-complete');
    if (result.phase !== 'passed') throw Error('proof_not_ready');
    await showProof();
  }
  async function readySnapshot() {
    const current = epoch;
    let state = await snapshot();
    for (let n = 0; state.kind === 'waiting' && n < 20; n++) {
      if (!alive || current !== epoch) throw Error('connection_closed');
      await new Promise((resolve) => setTimeout(resolve, 500));
      state = await snapshot();
    }
    return state;
  }
  async function observe(wait: boolean) {
    const current = epoch;
    for (let n = 0; n < (wait ? 30 : 1); n++) {
      if (!alive || current !== epoch) throw Error('connection_closed');
      const state = wait ? await snapshot() : await readySnapshot();
      if (state.kind === 'candidate') {
        await complete();
        return;
      }
      if (state.kind === 'verification') {
        panel('verification');
        message(
          state.rejected
            ? 'Park.io did not accept that verification code.'
            : 'Enter the code requested by Park.io.',
        );
        return;
      }
      if (state.kind === 'credentials' && (!wait || state.rejected)) {
        panel('credentials');
        message(
          state.rejected
            ? 'Park.io did not accept that sign-in. Check your username and password.'
            : '',
        );
        return;
      }
      if (state.kind === 'challenge') {
        panel('challenge');
        message('');
        return;
      }
      if (n + 1 < (wait ? 30 : 1))
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw Error('sign_in_outcome_unknown');
  }
  function explain(error: unknown) {
    const key = error instanceof Error ? error.message : '';
    const messages: Record<string, string> = {
      account_authentication_required:
        'Confirm your domains.domains account, then reopen the connection proof.',
      daily_browser_budget:
        'The daily sign-in attempt limit has been reached. Return to connection details to check the proof status.',
      authentication_required:
        'Park.io authentication has not been verified yet.',
      active_view_required:
        'The Active Orders view needs qualification. Your sign-in may have succeeded, but no holdings proof has passed.',
      export_contract_required:
        'Park.io’s holdings export needs qualification. Your sign-in may have succeeded, but no holdings proof has passed.',
      schema_required:
        'Park.io’s export columns need qualification before its holdings can be verified.',
      cookie_contract_required:
        'Park.io’s session format needs qualification before a background read is safe.',
      sign_in_outcome_unknown:
        'The sign-in result is not confirmed. Check the connection before submitting credentials again.',
      rotation_contract_required:
        'Park.io rotated the session during the background read. Session persistence needs further qualification.',
      holdings_differ:
        'The background read did not match the browser holdings. No proof has passed.',
      close_browser_first:
        'The temporary browser has not finished closing. Check the connection again shortly.',
    };
    fail(
      messages[key] ??
        'The connection could not be verified. Check the connection or open its details to continue.',
    );
  }
  async function run(work: () => Promise<void>) {
    if (busy) return;
    busy = true;
    root.querySelectorAll<HTMLButtonElement>('form button').forEach((e) => {
      e.disabled = true;
    });
    try {
      await work();
    } catch (error) {
      if (alive) explain(error);
    } finally {
      busy = false;
      root.querySelectorAll<HTMLButtonElement>('form button').forEach((e) => {
        e.disabled = false;
      });
    }
  }
  async function resume() {
    const state = await api<{
      phase: string;
      error?: string;
      attemptId?: string;
    }>('/status', 'GET');
    attemptId = state.attemptId;
    if (state.phase === 'passed') {
      await showProof();
      return;
    }
    if (['ready', 'closing'].includes(state.phase)) {
      await complete();
      return;
    }
    if (state.phase === 'blocked')
      throw Error(state.error ?? 'proof_not_ready');
    if (!['login', 'checking'].includes(state.phase)) {
      panel('credentials');
      message('');
      return;
    }
    try {
      await connect(false);
    } catch {
      panel('credentials');
      message('Enter your Park.io credentials to start a fresh sign-in.');
      return;
    }
    await observe(false);
  }
  function login(event: Event) {
    event.preventDefault();
    const form = root.querySelector<HTMLFormElement>('#native-login')!;
    if (busy || !form.reportValidity()) return;
    const u = username.value,
      p = password.value;
    clearSecrets();
    void run(async () => {
      panel('working');
      root.querySelector<HTMLElement>('#native-heading')!.textContent =
        'Signing in to Park.io…';
      root.querySelector<HTMLElement>('#native-progress')!.textContent =
        'Your credentials are being used for this sign-in only.';
      await connect(true);
      const state = await readySnapshot();
      if (state.kind !== 'credentials') {
        await observe(false);
        return;
      }
      await call(parkioNativeLogin, [u, p, attemptId ?? '']);
      await observe(true);
    });
  }
  function verify(event: Event) {
    event.preventDefault();
    const form = root.querySelector<HTMLFormElement>('#native-verification')!;
    if (busy || !form.reportValidity()) return;
    const value = code.value;
    clearSecrets();
    void run(async () => {
      panel('working');
      root.querySelector<HTMLElement>('#native-heading')!.textContent =
        'Checking verification…';
      root.querySelector<HTMLElement>('#native-progress')!.textContent =
        'The holdings check continues automatically after verification.';
      await connect(false);
      await call(parkioNativeVerification, [value]);
      await observe(true);
    });
  }
  root.querySelector('#native-connect')!.addEventListener('click', login);
  root.querySelector('#native-login')!.addEventListener('submit', login);
  root.querySelector('#native-verify')!.addEventListener('click', verify);
  root
    .querySelector('#native-verification')!
    .addEventListener('submit', verify);
  root.querySelector('#native-login')!.addEventListener('keydown', (event) => {
    const key = event as KeyboardEvent;
    if (key.key !== 'Enter' || (key.target as HTMLElement).tagName !== 'INPUT')
      return;
    key.preventDefault();
    if (key.target === username) password.focus();
    else login(key);
  });
  root
    .querySelector('#native-verification')!
    .addEventListener('keydown', (event) => {
      const key = event as KeyboardEvent;
      if (key.key === 'Enter') verify(key);
    });
  root.querySelector('#native-show')!.addEventListener('click', (event) => {
    const visible = password.type === 'password';
    password.type = visible ? 'text' : 'password';
    (event.currentTarget as HTMLButtonElement).textContent = visible
      ? 'Hide'
      : 'Show';
    (event.currentTarget as HTMLButtonElement).setAttribute(
      'aria-pressed',
      String(visible),
    );
  });
  root.querySelector('#native-check')!.addEventListener('click', () => {
    disconnect();
    void run(resume);
  });
  root.querySelector('#native-resume')!.addEventListener('click', () => {
    disconnect();
    void run(resume);
  });
  root.querySelector('#native-retest')!.addEventListener(
    'click',
    () =>
      void run(async () => {
        const r = await api<{ phase: string }>('/native-retest');
        if (r.phase !== 'passed') throw Error('proof_not_ready');
        await showProof();
      }),
  );
  window.addEventListener('pagehide', () => {
    alive = false;
    clearTimeout(timer);
    clearSecrets();
    disconnect();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) location.reload();
  });
  void run(resume);
}
