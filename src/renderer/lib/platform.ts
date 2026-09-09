// Which host the renderer is running under. Desktop is the default; the web
// bootstrap (main.tsx) marks the web host and records its auth mode before
// the app renders. Kept tiny and synchronous so any component can branch on
// it without a store round trip.

export type AuthMode =
  'password' | 'cloudflare-access' | 'external' | 'gateway';

let web = false;
let authMode: AuthMode | null = null;

export function markWeb(mode: AuthMode): void {
  web = true;
  authMode = mode;
}

/** True in the self-hosted browser build; false in Electron. */
export function isWeb(): boolean {
  return web;
}

/** The web host's DOMBOT_AUTH mode; null on desktop. */
export function webAuthMode(): AuthMode | null {
  return authMode;
}

/** Ends the web session (password mode) and returns to the login screen. */
export async function signOut(): Promise<void> {
  await fetch(hostPath('/auth/logout'), {
    method: 'POST',
    credentials: 'same-origin',
  });
  if (webAuthMode() === 'gateway') window.location.assign('/login');
  else window.location.reload();
}

export function hostPath(path: string): string {
  const prefix =
    window.location.pathname.match(/^\/w\/[a-f0-9-]{36}(?=\/)/)?.[0] ?? '';
  return path.startsWith('/') ? prefix + path : path;
}
