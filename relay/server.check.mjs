import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRelay } from './server.mjs';

test('the supervised entry point starts through a release symlink', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dombot-relay-start-'));
  let child;
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-subj',
        '/CN=localhost',
        '-days',
        '1',
        '-keyout',
        dir + '/key.pem',
        '-out',
        dir + '/cert.pem',
      ],
      { stdio: 'ignore' },
    );
    await symlink(
      fileURLToPath(new URL('./server.mjs', import.meta.url)),
      dir + '/current.mjs',
    );
    await writeFile(
      dir + '/config.json',
      JSON.stringify({
        token: 'test-only-token-'.repeat(4),
        upstream: {
          host: '194.153.254.242',
          port: 12323,
          username: 'synthetic',
          password: 'synthetic',
        },
        certFile: dir + '/cert.pem',
        keyFile: dir + '/key.pem',
        port: 0,
      }),
    );
    child = spawn(process.execPath, [dir + '/current.mjs'], {
      env: { ...process.env, RELAY_CONFIG_FILE: dir + '/config.json' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error('Relay did not start')),
        5000,
      );
      child.stdout.on('data', (data) => {
        if (data.toString().includes('relay-ready')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(Error('Relay exited before readiness: ' + code));
      });
    });
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test('relay authenticates, restricts targets, uses its own upstream credentials and forwards opaque bytes', async () => {
  const requests = [];
  const upstream = net.createServer((socket) => {
    let head = '';
    const receive = (data) => {
      head += data.toString();
      if (!head.includes('\r\n\r\n')) return;
      requests.push(head);
      socket.off('data', receive);
      socket.write('HTTP/1.1 200 OK\r\n\r\n');
      socket.on('data', (bytes) => socket.write(bytes));
    };
    socket.on('data', receive);
    socket.on('error', () => {});
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const token = 'local-test-relay-token-'.repeat(3);
  const relay = createRelay({
    token,
    upstream: {
      host: '127.0.0.1',
      port: upstream.address().port,
      username: 'upstream-user',
      password: 'upstream-secret',
    },
  });
  relay.listen(0, '127.0.0.1');
  await once(relay, 'listening');
  const connect = async (target, auth) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: relay.address().port,
      method: 'CONNECT',
      path: target,
      headers: auth ? { 'Proxy-Authorization': auth } : {},
    });
    req.end();
    const [response, socket] = await once(req, 'connect');
    return { response, socket };
  };
  const auth = 'Basic ' + Buffer.from('relay:' + token).toString('base64');
  try {
    const missing = await connect('api.namecheap.com:443');
    assert.equal(missing.response.statusCode, 407);
    missing.socket.destroy();
    const forbidden = await connect('example.com:443', auth);
    assert.equal(forbidden.response.statusCode, 403);
    forbidden.socket.destroy();
    assert.equal(requests.length, 0);
    const allowed = await connect('api.namecheap.com:443', auth);
    assert.equal(allowed.response.statusCode, 200);
    assert.match(requests[0], /^CONNECT api\.namecheap\.com:443 HTTP\/1\.1/);
    assert.ok(
      requests[0].includes(
        Buffer.from('upstream-user:upstream-secret').toString('base64'),
      ),
    );
    assert.ok(!requests[0].includes(token));
    const encrypted = Buffer.from([0x16, 0x03, 0x03, 0, 3, 0xaa, 0x01, 0xff]);
    allowed.socket.write(encrypted);
    const [echo] = await once(allowed.socket, 'data');
    assert.deepEqual(echo, encrypted);
    allowed.socket.destroy();
  } finally {
    relay.closeAllConnections();
    await new Promise((resolve) => relay.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});
