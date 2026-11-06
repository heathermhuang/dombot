import {
  parkioMobileConnection,
  parkioFocusExpression,
  mayTypeIntoParkio,
} from './parkio-mobile-contract';

const root = document.getElementById('parkio-mobile');
function setup(root: HTMLElement) {
  const keyboard = root.querySelector<HTMLInputElement>('#parkio-keyboard')!;
  const viewer = root.querySelector<HTMLIFrameElement>('#parkio-viewer')!;
  const status = root.querySelector<HTMLElement>('#parkio-keyboard-status')!;
  const say = (message: string) => {
    status.textContent = message;
  };
  let socket: WebSocket | null = null;
  let nextId = 0;
  let composing = false;
  let alive = true;
  let busy = false;
  let inputEpoch = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  function send<T>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (socket?.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected'));
        return;
      }
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Input timed out'));
      }, 10000);
      pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject: () => reject(new Error('Remote input rejected')),
        timer,
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  function clearPending() {
    inputEpoch++;
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject();
    }
    pending.clear();
  }
  function enqueue(action: () => Promise<void>) {
    const epoch = inputEpoch;
    queue = queue
      .then(() => {
        if (alive && epoch === inputEpoch) return action();
      })
      .catch(() => {
        if (alive)
          say(
            'Tap a Park.io field first, or reopen the sign-in window if it expired.',
          );
      });
  }
  async function focused() {
    const response = await send<{ result?: { value?: unknown } }>(
      'Runtime.evaluate',
      { expression: parkioFocusExpression, returnByValue: true },
    );
    if (!mayTypeIntoParkio(response.result?.value))
      throw new Error('Select a Park.io field');
  }
  function flush() {
    if (composing) return;
    const text = keyboard.value;
    keyboard.value = '';
    if (keyboard.readOnly || document.activeElement !== keyboard) return;
    if (!text) return;
    if (text.length > 2048) {
      say('Please enter a shorter piece of text.');
      return;
    }
    enqueue(async () => {
      await focused();
      await send('Input.insertText', { text });
      say('Input sent to the selected Park.io field.');
    });
  }
  function key(value: string) {
    enqueue(async () => {
      if (value !== 'Tab') await focused();
      else {
        const result = await send<{ result?: { value?: string } }>(
          'Runtime.evaluate',
          { expression: 'location.origin', returnByValue: true },
        );
        if (
          !['https://park.io', 'https://www.park.io'].includes(
            result.result?.value ?? '',
          )
        )
          throw new Error('Select Park.io');
      }
      const codes: Record<string, number> = { Tab: 9, Backspace: 8, Enter: 13 };
      const params = {
        key: value,
        code: value,
        windowsVirtualKeyCode: codes[value],
        nativeVirtualKeyCode: codes[value],
      };
      await send('Input.dispatchKeyEvent', {
        ...params,
        type: 'keyDown',
        ...(value === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}),
      });
      await send('Input.dispatchKeyEvent', { ...params, type: 'keyUp' });
      say(
        value === 'Tab'
          ? 'Next Park.io field selected.'
          : 'Key sent to Park.io.',
      );
    });
  }

  // Keep autofill inactive until the user deliberately opens the secure input.
  keyboard.addEventListener('pointerdown', () => {
    keyboard.readOnly = false;
  });
  keyboard.addEventListener('click', () => {
    keyboard.readOnly = false;
    keyboard.focus();
  });
  keyboard.addEventListener('blur', () => {
    keyboard.value = '';
    keyboard.readOnly = true;
  });
  keyboard.addEventListener('compositionstart', () => {
    composing = true;
  });
  keyboard.addEventListener('compositionend', () => {
    composing = false;
    flush();
  });
  keyboard.addEventListener('input', (event) => {
    if (!(event as InputEvent).isComposing) flush();
  });
  keyboard.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.isTrusted) keyboard.readOnly = false;
    if (
      ['Enter', 'Tab', 'Backspace'].includes(event.key) &&
      (event.key !== 'Backspace' || !keyboard.value)
    ) {
      event.preventDefault();
      key(event.key);
    }
  });
  keyboard.addEventListener('beforeinput', (event) => {
    if (event.isComposing) return;
    if (event.inputType === 'deleteContentBackward' && !keyboard.value) {
      event.preventDefault();
      key('Backspace');
    }
    if (['insertLineBreak', 'insertParagraph'].includes(event.inputType)) {
      event.preventDefault();
      key('Enter');
    }
  });
  root
    .querySelectorAll<HTMLButtonElement>('[data-remote-key]')
    .forEach((button) =>
      button.addEventListener('click', () => {
        keyboard.readOnly = false;
        keyboard.focus();
        key(button.dataset.remoteKey!);
      }),
    );

  async function connect() {
    if (busy) return;
    busy = true;
    alive = true;
    say('Opening Park.io…');
    try {
      const response = await fetch('/admin/parkio-pilot/mobile-connection', {
        method: 'POST',
        credentials: 'same-origin',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (
        !response.ok ||
        !response.headers.get('content-type')?.includes('application/json')
      )
        throw new Error('Sign-in required');
      const capability = await response.json();
      const connection = parkioMobileConnection({
        devtoolsFrontendUrl: capability.viewerUrl,
        webSocketDebuggerUrl: capability.socketUrl,
      });
      if (!alive) return;
      viewer.src = connection.viewerUrl;
      const peer = new WebSocket(connection.socketUrl);
      socket = peer;
      peer.addEventListener('message', (event) => {
        if (socket !== peer) return;
        let message: { id?: number; error?: unknown; result?: unknown };
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (!message.id) return;
        const item = pending.get(message.id);
        if (!item) return;
        clearTimeout(item.timer);
        pending.delete(message.id);
        if (message.error) item.reject();
        else item.resolve(message.result);
      });
      peer.addEventListener('open', () => {
        if (socket !== peer || !alive) return;
        // Set once; opening the phone keyboard must not repeatedly reflow the remote form.
        const width = Math.min(
          900,
          Math.max(320, Math.floor(viewer.clientWidth)),
        );
        void send('Emulation.setDeviceMetricsOverride', {
          width,
          height: 400,
          deviceScaleFactor: 1,
          mobile: true,
        }).catch(() => {});
        keyboard.disabled = false;
        root
          .querySelectorAll<HTMLButtonElement>('[data-remote-key]')
          .forEach((button) => {
            button.disabled = false;
          });
        say(
          'Tap Username in Park.io, then tap the keyboard box above to type.',
        );
      });
      peer.addEventListener('close', () => {
        if (socket !== peer) return;
        clearPending();
        keyboard.disabled = true;
        root
          .querySelectorAll<HTMLButtonElement>('[data-remote-key]')
          .forEach((button) => {
            button.disabled = true;
          });
        if (alive)
          say(
            'This sign-in connection closed. Return to the test to reopen it.',
          );
      });
      peer.addEventListener('error', () => {
        if (socket === peer && alive)
          say(
            'The input connection is unavailable. Return to the test to reopen it.',
          );
      });
    } catch {
      say(
        'Confirm your domains.domains account again, then reopen the mobile sign-in view.',
      );
    } finally {
      busy = false;
    }
  }
  window.addEventListener('pagehide', () => {
    alive = false;
    keyboard.value = '';
    clearPending();
    socket?.close();
    socket = null;
    viewer.src = 'about:blank';
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) void connect();
  });
  void connect();
}
if (root) setup(root);
