import { describe, expect, it } from 'vitest';
import gateway from './gateway';
import { publicSourceLinks } from './attribution';
import { sourcePage } from './source';

describe('public corresponding-source offer', () => {
  it('serves full hosted source without an account or database binding', async () => {
    const commit = 'a'.repeat(40);
    const response = await gateway.fetch(
      new Request('https://domains.domains/source'),
      { SOURCE_COMMIT: commit } as HostedEnv,
    );
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(
      `https://github.com/heathermhuang/dombot/tree/${commit}/src/hosted`,
    );
    expect(html).toContain(
      `https://github.com/heathermhuang/dombot/archive/${commit}.tar.gz`,
    );
    expect(html).toContain('https://github.com/aoxborrow/dombot');
    expect(html).toContain('Aaron Oxborrow');
    expect(html).not.toContain('Magic Crystal Limited');
    expect(html).toContain('GNU Affero General Public License v3.0 or later');
    expect(html).toContain('Build and self-hosting instructions');
    expect(html).toContain('Source for this deployment');
  });
  it('does not invent an exact deployed revision when the operator has not set it', () => {
    const html = sourcePage();
    expect(html).toContain('/tree/main/src/hosted');
    expect(html).not.toContain('Deployment revision:');
    expect(html).not.toContain('Source for this deployment');
  });
  it('accepts only commit hashes for revision-specific source URLs', () => {
    for (const value of [
      '<script>bad()</script>',
      '../../private',
      'javascript:alert(1)',
      'https://other.example',
    ]) {
      expect(publicSourceLinks(value).revision).toBe('main');
      expect(sourcePage(value)).not.toContain(value);
    }
  });
});
