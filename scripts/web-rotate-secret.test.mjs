import { afterEach, describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const command = resolve('scripts/web-rotate-secret.mjs'),
  temporary = [];
afterEach(() => {
  for (const dir of temporary.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function run(mode) {
  const dir = mkdtempSync(join(tmpdir(), 'dombot-rotation-cli-'));
  temporary.push(dir);
  const stub = join(dir, 'stub.mjs');
  writeFileSync(
    stub,
    `
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {writeFileSync} from 'node:fs';
import {hkdfSync} from 'node:crypto';
const mode=${JSON.stringify(mode)},events=[];
let generation='old-generation',next,secretChanged=false,retireCalls=0;
const save=()=>writeFileSync('events.json',JSON.stringify(events));
const initial=JSON.stringify({format:'dombot-data',version:9,namespaces:{fixture:{value:'initial'}}});
const final=JSON.stringify({format:'dombot-data',version:9,namespaces:{fixture:{value:'final-after-drain'}}});
cp.spawnSync=(_bin,args,options)=>{
 if(!args.includes('DOMBOT_SECRET')||!args.includes('put'))throw Error('Unexpected process');
 next=Buffer.from(hkdfSync('sha256',Buffer.from(options.input.trim(),'base64'),Buffer.alloc(0),'dombot/root-generation/v1',32)).toString('base64url');
 events.push({operation:'secret-put',next});save();secretChanged=true;generation=next;
 return {status:mode==='secret-unknown'?1:0};
};syncBuiltinESMExports();
const originalTimeout=globalThis.setTimeout;globalThis.setTimeout=(fn,ms,...args)=>originalTimeout(fn,ms===2000?0:ms,...args);
globalThis.fetch=async(input,init={})=>{
 const path=new URL(input).pathname,headers=new Headers(init.headers),body=init.body?JSON.parse(init.body):{};
 events.push({operation:path,generation:headers.get('X-DomBot-Root-Generation'),...(path==='/api/importData'?{imported:body.args[0]}:{})});save();
 const result=(value,status=200,extra={})=>Response.json(value,{status,headers:{'X-DomBot-Root-Generation':generation,...extra}});
 if(path==='/auth/status')return result({mode:'password',rootRetirement:mode!=='incompatible'});
 if(path==='/auth/login')return result({ok:true},200,{'Set-Cookie':'dombot_session=synthetic; Path=/'});
 if(path==='/api/exportData')return result({result:initial});
 if(path==='/auth/retire-root'){
  if(++retireCalls===1)return result({drained:false,active:1},202);
  return result({drained:true,bundle:final});
 }
 if(path==='/api/importData'){
  if(!secretChanged||headers.get('X-DomBot-Root-Generation')!==next)throw Error('Unbound import');
  if(mode==='old-isolate')return result({error:'Encryption root changed; no operation performed'},409);
  if(mode==='import-unknown')return result({error:'Unknown import outcome'},500);
  return result({result:{entries:1,namespaces:1}});
 }
 throw Error('Unexpected request '+path);
};
`,
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) =>
        !k.startsWith('DOMBOT_') &&
        !k.startsWith('CF_ACCESS_') &&
        k !== 'NODE_OPTIONS',
    ),
  );
  const result = spawnSync(process.execPath, ['--import', stub, command], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 15_000,
    env: {
      ...env,
      DOMBOT_URL: 'https://synthetic.example',
      DOMBOT_PASSWORD: 'synthetic-password',
      DOMBOT_BACKUP_PASSPHRASE: 'synthetic-backup-passphrase',
    },
  });
  const events = JSON.parse(readFileSync(join(dir, 'events.json'), 'utf8'));
  return { dir, result, events };
}
describe('rotation command fail-closed sequencing', () => {
  it('drains before secret update and imports the final snapshot with a new-generation binding', () => {
    const { dir, result, events } = run('happy');
    expect(result.status, result.stderr).toBe(0);
    const secret = events.findIndex((e) => e.operation === 'secret-put');
    expect(
      events
        .slice(0, secret)
        .filter((e) => e.operation === '/auth/retire-root'),
    ).toHaveLength(2);
    const imported = events.find((e) => e.operation === '/api/importData');
    expect(imported.imported).toContain('final-after-drain');
    expect(imported.imported).not.toContain('initial');
    expect(imported.generation).toBe(events[secret].next);
    const key = readdirSync(join(dir, '.wrangler')).find((f) =>
      f.startsWith('rotation-root-'),
    );
    const raw = readFileSync(join(dir, '.wrangler', key), 'utf8').trim();
    expect(result.stdout).not.toContain(raw);
    expect(statSync(join(dir, '.wrangler', key)).mode & 0o777).toBe(0o600);
    const backup = readdirSync(dir).find((f) =>
      f.endsWith('-pre-rotation.json'),
    );
    expect(readFileSync(join(dir, backup), 'utf8')).not.toContain(
      'final-after-drain',
    );
    expect(
      JSON.parse(readFileSync(join(dir, backup), 'utf8')).encrypted.alg,
    ).toBe('AES-256-GCM');
  });
  it('refuses an incompatible runtime before exporting or changing a secret', () => {
    const { result, events } = run('incompatible');
    expect(result.status).not.toBe(0);
    expect(events.map((e) => e.operation)).toEqual(['/auth/status']);
  });
  it.each(['old-isolate', 'import-unknown'])(
    'does not retry a rejected or ambiguous import (%s)',
    (mode) => {
      const { result, events } = run(mode);
      expect(result.status).not.toBe(0);
      expect(
        events.filter((e) => e.operation === '/api/importData'),
      ).toHaveLength(1);
      expect(events.filter((e) => e.operation === 'secret-put')).toHaveLength(
        1,
      );
    },
  );
  it('preserves recovery files and performs no import after an uncertain secret update', () => {
    const { dir, result, events } = run('secret-unknown');
    expect(result.status).not.toBe(0);
    expect(events.some((e) => e.operation === '/api/importData')).toBe(false);
    expect(
      readdirSync(join(dir, '.wrangler')).some((f) =>
        f.startsWith('rotation-root-'),
      ),
    ).toBe(true);
    expect(readdirSync(dir).some((f) => f.endsWith('-pre-rotation.json'))).toBe(
      true,
    );
  });
});
