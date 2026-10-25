import { describe, expect, it } from 'vitest';
import gateway from './gateway';
import edge from './lander-edge';
import {
  salesFormScript,
  salesFormScriptPath,
} from '../shared/sales-form-script';
import {
  legacySalesFormScript,
  legacySalesFormScriptPath,
} from './sales-form-compat';

describe('rolling public sales asset compatibility', () => {
  it('serves exact old and new bytes on canonical and custom-host origins', async () => {
    expect(salesFormScriptPath).not.toBe(legacySalesFormScriptPath);
    for (const [path, body] of [
      [salesFormScriptPath, salesFormScript],
      [legacySalesFormScriptPath, legacySalesFormScript],
    ])
      for (const worker of [gateway, edge]) {
        const response = await worker.fetch(
          new Request('https://domains.domains' + path),
          {} as HostedEnv,
        );
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toContain('javascript');
        expect(await response.text()).toBe(body);
      }
  });
});
