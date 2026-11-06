import { beforeAll, describe, it, expect } from 'vitest';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { emailCode, emailConfirm } from './auth-views';

let script: string;
beforeAll(async () => {
  script = (
    await build({
      entryPoints: ['hosted/browser-auth.ts'],
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      logLevel: 'silent',
    })
  ).outputFiles[0].text;
});

function fixture() {
  const pageshow: ((event: { persisted: boolean }) => void)[] = [];
  const forms = ['/auth/email/request', '/auth/email/confirm'].map((action) => {
    const listeners: ((event: {
      defaultPrevented: boolean;
      preventDefault(): void;
    }) => void)[] = [];
    const button = {
      disabled: false,
      textContent: action.endsWith('request') ? 'Send link' : 'Continue',
    };
    const attributes = new Map<string, string>();
    const form = {
      dataset: {} as Record<string, string>,
      querySelector: () => button,
      getAttribute: () => action,
      setAttribute: (key: string, value: string) => attributes.set(key, value),
      removeAttribute: (key: string) => attributes.delete(key),
      addEventListener: (
        _name: string,
        listener: (event: {
          defaultPrevented: boolean;
          preventDefault(): void;
        }) => void,
      ) => listeners.push(listener),
    };
    return {
      form,
      button,
      attributes,
      submit(prevented = false) {
        const event = {
          defaultPrevented: prevented,
          preventDefault() {
            this.defaultPrevented = true;
          },
        };
        for (const listener of listeners) listener(event);
        return event.defaultPrevented;
      },
    };
  });
  runInNewContext(script, {
    document: {
      getElementById: () => null,
      querySelectorAll: (selector: string) =>
        selector.includes('/auth/email/') ? forms.map((f) => f.form) : [],
    },
    window: {
      addEventListener: (
        _name: string,
        listener: (event: { persisted: boolean }) => void,
      ) => pageshow.push(listener),
    },
    location: { pathname: '/auth/email/confirm' },
    AbortController,
  });
  return {
    forms,
    restore(persisted: boolean) {
      pageshow.forEach((listener) => listener({ persisted }));
    },
  };
}

describe('email authentication native submission guard', () => {
  it('loads submission protection on code, correction, link and signup confirmation pages', () => {
    for (const html of [
      emailCode('sample'),
      emailCode('sample', 'Try again'),
      emailConfirm('sample', 'proof', 'existing@example.test', false),
      emailConfirm('sample', 'proof', 'new@example.test', true),
    ]) {
      expect(html).toContain('type="module" src="/auth/browser.js"');
      expect(html).toContain('action="/auth/email/confirm" method="post"');
    }
  });
  it('preserves the first POST and blocks duplicate code submissions before a response arrives', () => {
    const { forms } = fixture();
    const form = forms[1];
    expect(form.submit()).toBe(false);
    expect(form.button.disabled).toBe(true);
    expect(form.button.textContent).toBe('Confirming…');
    expect(form.attributes.get('aria-busy')).toBe('true');
    expect(form.submit()).toBe(true);
  });
  it('prevents duplicate email requests from replacing the first challenge', () => {
    const { forms } = fixture();
    expect(forms[0].submit()).toBe(false);
    expect(forms[0].button.textContent).toBe('Sending email…');
    expect(forms[0].submit()).toBe(true);
    expect(forms[1].submit()).toBe(false);
  });
  it('restores the form only when returning through the back-forward cache', () => {
    const f = fixture();
    f.forms[1].submit();
    f.restore(false);
    expect(f.forms[1].submit()).toBe(true);
    f.restore(true);
    expect(f.forms[1].button.disabled).toBe(false);
    expect(f.forms[1].button.textContent).toBe('Continue');
    expect(f.forms[1].attributes.has('aria-busy')).toBe(false);
    expect(f.forms[1].submit()).toBe(false);
  });
  it('does not lock a form whose submission another handler already cancelled', () => {
    const { forms } = fixture();
    expect(forms[1].submit(true)).toBe(true);
    expect(forms[1].button.disabled).toBe(false);
    expect(forms[1].submit()).toBe(false);
  });
});
