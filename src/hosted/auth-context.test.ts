import { expect, it } from 'vitest';
import { reauthPage } from './auth-views';
it('explains domain confirmation without changing the passkey requirement', () => {
  const html = reauthPage(
    '/w/fixture/#/?q=fixture.example',
    true,
    'owner@example.com',
    true,
    'domain-setup',
  );
  expect(html).toContain(
    'You’re signed in. DNS changes need a recent identity check.',
  );
  expect(html).toContain('data-passkey="reauth"');
  expect(html).not.toContain('action="/auth/email/request"');
  expect(html).not.toContain('action="/auth/password/confirm"');
  expect(html).toContain('Back to saved connection');
});
it('keeps ordinary email/password confirmation and escapes saved return paths', () => {
  const html = reauthPage(
    '/w/fixture/?q="<script>',
    false,
    'owner@example.com',
    true,
    'domain-setup',
  );
  expect(html).toContain('name="intent" value="reauth"');
  expect(html).toContain('action="/auth/password/confirm"');
  expect(html).not.toContain('<script>');
  expect(html).toContain('five minutes');
});
