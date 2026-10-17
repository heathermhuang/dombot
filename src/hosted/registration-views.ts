import { page, escapeHtml as e } from './views';
import { legalVersion } from './legal';

export const signupStart = () =>
  page(
    'Create an account',
    `<form action="/signup" method="post"><span class="eyebrow">Free early access</span><h1>Your domains, together.</h1><p>Create a private account for your domain portfolio. Verify your email, choose a password, then connect your registrars. No invitation or credit card required.</p><label>Email<input name="email" type="email" autocomplete="email" maxlength="254" required></label><button type="submit">Send verification link</button><p class="note">Free during early access, subject to available capacity. Registrar charges are separate. Read our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</p><p><a href="/login">Already have an account? Sign in</a></p></form>`,
  );
export const signupFinish = (code: string, email: string, error = '') =>
  page(
    'Create your account',
    `<form action="/signup/verify" method="post"><span class="eyebrow">Email verified</span><h1>Create your account.</h1><p>For ${e(email)}. Your portfolio starts private.</p>${error ? `<p class="error" role="alert">${e(error)}</p>` : ''}<input type="hidden" name="code" value="${e(code)}"><input type="hidden" name="legalVersion" value="${legalVersion}"><label>Password<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="256" required></label><label>Confirm password<input name="confirm" type="password" autocomplete="new-password" minlength="12" maxlength="256" required></label><label class="check"><input type="checkbox" name="accept" value="yes" required><span>I agree to the <a href="/terms">Terms of Service</a> and acknowledge the <a href="/privacy">Privacy Policy</a>.</span></label><button type="submit">Create account</button><p class="note">No subscription fee during early access. Registrar charges are separate.</p></form>`,
  );
export const recoveryStart = (error = '') =>
  page(
    'Recover your account',
    `<form action="/recover/request" method="post"><h1>Recover your account.</h1><p>Enter the email address you use to sign in. We’ll send a link that expires in 15 minutes and can be used once.</p>${error ? `<p class="error" role="alert">${e(error)}</p>` : ''}<label>Email<input name="email" type="email" autocomplete="email" maxlength="254" required></label><button type="submit">Send recovery link</button><p class="note">Never email passwords, API keys or backups. <a href="mailto:domains@domains.domains">Contact support</a> if you no longer have access to your email.</p><p><a href="/login">Back to sign in</a></p></form>`,
  );
export const checkEmail = (kind: 'signup' | 'recovery') =>
  page(
    'Check your email',
    `<h1>Check your email.</h1><p>${kind === 'signup' ? 'If your address can be used for a new account, we’ll send a verification link. Already registered? Sign in or request account recovery.' : 'If an active account uses that address, we’ll send a recovery link.'} Check your spam folder too. Delivery may take a few minutes.</p><p><a href="/login">Sign in</a> · <a href="/recover">Recover an account</a></p>`,
  );
