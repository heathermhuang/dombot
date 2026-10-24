import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
} from '@simplewebauthn/browser';
const status = document.getElementById('auth-status');
const say = (value: string) => {
  if (status) status.textContent = value;
};
async function post(path: string, body: unknown) {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    if (data.reauth) location.assign(data.reauth);
    throw new Error(
      data.error ?? 'Could not complete this request. Try again.',
    );
  }
  return data;
}
for (const button of document.querySelectorAll<HTMLButtonElement>(
  '[data-passkey]',
)) {
  if (!browserSupportsWebAuthn()) {
    button.hidden = true;
    continue;
  }
  button.addEventListener('click', async () => {
    button.disabled = true;
    say('Follow your browser’s passkey prompt.');
    try {
      const kind = button.dataset.passkey;
      const next = document.querySelector<HTMLInputElement>(
        '#auth-next, input[name="next"]',
      )?.value;
      const challenge = await post('/auth/passkeys/options', { kind, next });
      const response =
        kind === 'register'
          ? await startRegistration({ optionsJSON: challenge.options })
          : await startAuthentication({ optionsJSON: challenge.options });
      const result = await post('/auth/passkeys/verify', {
        id: challenge.id,
        response,
      });
      // The server binds and validates the destination when issuing the
      // challenge. Never navigate directly to text read from the page.
      location.assign(result.next);
    } catch {
      say(
        'Passkey confirmation was not completed. Try again, or use email to sign in. Existing passkeys are still required for sensitive actions.',
      );
      button.disabled = false;
    }
  });
}
for (const button of document.querySelectorAll<HTMLButtonElement>(
  '[data-remove-passkey]',
))
  button.addEventListener('click', async () => {
    if (
      !confirm(
        `Remove ${button.dataset.passkeyName ?? 'this passkey'}? Other browsers will be signed out. Keep another working passkey for sensitive actions. Removing your last passkey restores email/password access to those actions.`,
      )
    )
      return;
    try {
      button.disabled = true;
      await post('/auth/passkeys/remove', { id: button.dataset.removePasskey });
      location.reload();
    } catch {
      say(
        'Passkey removal needs a fresh passkey confirmation. Please confirm your identity and try again.',
      );
      button.disabled = false;
    }
  });
// The unchanged upstream renderer receives a clear step-up response from the
// gateway. Redirect for authentication; do not replay a registrar write/export.
if (/^\/w\/[a-f0-9-]{36}\//.test(location.pathname)) {
  const original = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const response = await original(...args);
    const url = new URL(
      args[0] instanceof Request ? args[0].url : String(args[0]),
      location.href,
    );
    if (
      url.origin === location.origin &&
      url.pathname.startsWith('/w/') &&
      response.status === 428
    ) {
      try {
        const data = await response.clone().json();
        if (data.error === 'Confirm your identity before continuing.')
          location.assign(
            '/account/reauth?next=' +
              encodeURIComponent(location.pathname + location.search),
          );
      } catch {
        /* Original response still reaches its caller. */
      }
    }
    return response;
  };
}

for (const time of document.querySelectorAll<HTMLTimeElement>(
  'time[data-local-time]',
)) {
  const date = new Date(time.dateTime);
  if (Number.isFinite(date.getTime()))
    time.textContent = date.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
}
