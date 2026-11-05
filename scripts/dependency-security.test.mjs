import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import uri from 'fast-uri';
import qs from 'qs';
import { Address6 } from 'ip-address';
import { ipKeyGenerator } from 'express-rate-limit';
const require = createRequire(import.meta.url);
const sdkRequire = createRequire(
  require.resolve('@modelcontextprotocol/sdk/server/index.js'),
);
const Ajv = sdkRequire('ajv');

it('keeps AJV schema references working without decoding an encoded URI scheme', () => {
  for (const value of ['%6Aavascript:alert(1)', '%u006Aavascript:alert(1)']) {
    expect(uri.parse(value).scheme).not.toBe('javascript');
    expect(() => uri.resolve('https://fixture.invalid/', value)).toThrow(
      'URI scheme is malformed',
    );
  }
  expect(uri.equal('%68ttp://a/', 'http://a/')).toBe(false);
  const ajv = new Ajv();
  ajv.addSchema({
    $id: 'https://fixture.invalid/defs',
    definitions: { id: { type: 'integer' } },
  });
  const validate = ajv.compile({
    type: 'object',
    properties: {
      id: { $ref: 'https://fixture.invalid/defs#/definitions/id' },
    },
    required: ['id'],
  });
  expect(validate({ id: 1 })).toBe(true);
  expect(validate({ id: 'invalid' })).toBe(false);
});
it('preserves IPv6 rate-limit subnet grouping and rejects hostile zone input', async () => {
  expect(ipKeyGenerator('2001:db8:1234:5600::1')).toBe(
    ipKeyGenerator('2001:db8:1234:5600::2'),
  );
  expect(ipKeyGenerator('192.0.2.1')).toBe('192.0.2.1');
  expect(Address6.isValid('fe80::1%eth0')).toBe(true);
  // Isolate the advisory payload in a bounded process so a regression cannot hang CI.
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      '-e',
      `const {Address6}=require('ip-address');process.stdout.write(String(Address6.isValid('%'.repeat(1000000)+'\\n')));`,
    ],
    { cwd: process.cwd(), timeout: 5000 },
  );
  expect(stdout).toBe('false');
});
it('handles hostile comma-array coercions and keeps form/query semantics', () => {
  const value = JSON.parse('{"a":[{"toString":"x"}]}');
  for (const encodeValuesOnly of [false, true])
    expect(() =>
      qs.stringify(value, { arrayFormat: 'comma', encodeValuesOnly }),
    ).not.toThrow();
  expect(qs.parse('filter[status]=active&ids[]=a&ids[]=b')).toEqual({
    filter: { status: 'active' },
    ids: ['a', 'b'],
  });
  expect(qs.parse('__proto__[polluted]=1')).toEqual({});
});
it('keeps the parser process alive after trailing compressed bytes and accepts the next JSON request', async () => {
  const script = `const http=require('node:http'),z=require('node:zlib'),express=require('express');
    const app=express();app.use(express.json());app.use(express.urlencoded({extended:true}));app.post('/',(q,r)=>r.json(q.body));app.use((e,q,r,n)=>r.status(400).end());
    const server=app.listen(0,'127.0.0.1',async()=>{try{
      const send=(body,headers)=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:server.address().port,path:'/',method:'POST',headers},r=>{let b='';r.on('data',x=>b+=x);r.on('end',()=>resolve({status:r.statusCode,body:b}));});req.on('error',reject);req.end(body);});
      const body=Buffer.concat([z.brotliCompressSync(Buffer.from('{"ok":true}')),Buffer.from('trailing bytes')]);
      const first=await send(body,{'Content-Type':'application/json','Content-Encoding':'br','Content-Length':body.length});
      const second=await send('{"ok":true}',{'Content-Type':'application/json'});
      const form=await send('a[b]=c',{'Content-Type':'application/x-www-form-urlencoded'});
      console.log(JSON.stringify({first:first.status,second,form}));
    }catch(e){process.exitCode=1;}finally{server.close();}});`;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['-e', script],
    { cwd: process.cwd(), timeout: 5000 },
  );
  const result = JSON.parse(stdout);
  expect([200, 400]).toContain(result.first);
  expect(result.second).toEqual({ status: 200, body: '{"ok":true}' });
  expect(result.form).toEqual({ status: 200, body: '{"a":{"b":"c"}}' });
});
