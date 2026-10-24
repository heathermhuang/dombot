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

test('direct mode opens only the allowed IPv4 destination and forwards no upstream credentials', async () => {
  const connections = [],
    payloads = [];
  const echo = net.createServer((socket) => {
    socket.on('data', (bytes) => {
      payloads.push(bytes);
      socket.write(bytes);
    });
    socket.on('error', () => {});
  });
  echo.listen(0, '127.0.0.1');
  await once(echo, 'listening');
  const token = 'direct-mode-test-token-'.repeat(3);
  const relay = createRelay({ mode: 'direct', token }, undefined, (options) => {
    connections.push(options);
    return net.createConnection({
      host: '127.0.0.1',
      port: echo.address().port,
    });
  });
  relay.listen(0, '127.0.0.1');
  await once(relay, 'listening');
  async function request(target, secret = token) {
    const req = http.request({
      hostname: '127.0.0.1',
      port: relay.address().port,
      method: 'CONNECT',
      path: target,
      headers: {
        'Proxy-Authorization':
          'Basic ' + Buffer.from('relay:' + secret).toString('base64'),
      },
    });
    req.end();
    const [response, socket] = await once(req, 'connect');
    return { response, socket };
  }
  try {
    const bad = await request('api.namecheap.com:443', 'wrong');
    assert.equal(bad.response.statusCode, 407);
    bad.socket.destroy();
    const blocked = await request('127.0.0.1:443');
    assert.equal(blocked.response.statusCode, 403);
    blocked.socket.destroy();
    assert.equal(connections.length, 0);
    const good = await request('api.namecheap.com:443');
    assert.equal(good.response.statusCode, 200);
    assert.deepEqual(connections, [
      { host: 'api.namecheap.com', port: 443, family: 4 },
    ]);
    const bytes = Buffer.from([0x16, 0x03, 0x03, 0, 3, 0xaa, 0x01, 0xff]);
    good.socket.write(bytes);
    const [received] = await once(good.socket, 'data');
    assert.deepEqual(received, bytes);
    assert.deepEqual(Buffer.concat(payloads), bytes);
    good.socket.destroy();
    assert.throws(
      () =>
        createRelay({
          mode: 'direct',
          token,
          upstream: { username: 'unused', password: 'unused' },
        }),
      /Invalid relay/,
    );
  } finally {
    relay.closeAllConnections();
    await new Promise((r) => relay.close(r));
    await new Promise((r) => echo.close(r));
  }
});

test('migration chooses the route only from its authenticated token', async () => {
  const selected = [],
    payloads = [];
  let legacyObserved;
  const legacyReady = new Promise((resolve) => {
    legacyObserved = resolve;
  });
  const echo = net.createServer((socket) => {
    socket.on('data', (bytes) => {
      payloads.push(bytes);
      if (bytes.toString().startsWith('CONNECT ')) legacyObserved();
      socket.write(bytes);
    });
    socket.on('error', () => {});
  });
  echo.listen(0, '127.0.0.1');
  await once(echo, 'listening');
  const token = 'legacy-migration-token-'.repeat(3),
    directToken = 'direct-migration-token-'.repeat(3);
  const relay = createRelay(
    {
      mode: 'migrate',
      token,
      directToken,
      upstream: {
        host: '194.153.254.242',
        port: 12323,
        username: 'synthetic-upstream-user',
        password: 'synthetic-upstream-password',
      },
    },
    undefined,
    (options) => {
      selected.push(options);
      return net.createConnection({
        host: '127.0.0.1',
        port: echo.address().port,
      });
    },
  );
  relay.listen(0, '127.0.0.1');
  await once(relay, 'listening');
  async function request(secret) {
    const req = http.request({
      hostname: '127.0.0.1',
      port: relay.address().port,
      method: 'CONNECT',
      path: 'api.dynadot.com:443',
      headers: {
        'Proxy-Authorization':
          'Basic ' + Buffer.from('relay:' + secret).toString('base64'),
      },
    });
    req.end();
    return once(req, 'connect');
  }
  try {
    const [direct, socket] = await request(directToken);
    assert.equal(direct.statusCode, 200);
    assert.deepEqual(selected[0], {
      host: 'api.dynadot.com',
      port: 443,
      family: 4,
    });
    socket.destroy();
    const pending = request(token);
    await legacyReady;
    assert.deepEqual(selected[1], {
      host: '194.153.254.242',
      port: 12323,
      family: 4,
    });
    assert.match(
      Buffer.concat(payloads).toString(),
      /^CONNECT api\.dynadot\.com:443/,
    );
    // The echo is not an HTTP proxy, so the legacy connection is rejected rather than falling back directly.
    const [legacy, legacySocket] = await pending;
    assert.equal(legacy.statusCode, 502);
    legacySocket.destroy();
  } finally {
    relay.closeAllConnections();
    await new Promise((r) => relay.close(r));
    await new Promise((r) => echo.close(r));
  }
});
