import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const allowed = new Set([
  'api.namecheap.com:443',
  'api.dynadot.com:443',
  'ipv4.icanhazip.com:443',
  'www.cloudflare.com:443',
  'ipinfo.io:443',
]);
const digest = (value) => createHash('sha256').update(value).digest();

/** A fixed-source CONNECT relay. It never decrypts registrar TLS or accepts
 * a caller-selected upstream proxy. Credentials and payloads are never logged. */
export function createRelay(config, tlsOptions) {
  if (
    !config.token ||
    config.token.length < 32 ||
    !config.upstream?.username ||
    !config.upstream.password
  )
    throw Error('Invalid relay configuration');
  const maxConnections = Math.max(1, Math.min(16, config.maxConnections ?? 8));
  const expected = digest(
    'Basic ' + Buffer.from('relay:' + config.token).toString('base64'),
  );
  const authenticated = (request) =>
    timingSafeEqual(
      expected,
      digest(String(request.headers['proxy-authorization'] ?? '')),
    );
  let active = 0;
  const handler = (request, response) => {
    if (request.url !== '/healthz' || !authenticated(request)) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify({ ok: true, active, maxConnections }));
  };
  const server = tlsOptions
    ? https.createServer(
        {
          ...tlsOptions,
          minVersion: 'TLSv1.2',
          handshakeTimeout: 10000,
          maxHeaderSize: 8192,
        },
        handler,
      )
    : http.createServer({ maxHeaderSize: 8192 }, handler);
  server.maxConnections = 64;
  server.headersTimeout = 10000;
  server.requestTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('tlsClientError', () => {});
  server.on('connect', (request, client, head) => {
    client.on('error', () => {});
    const reject = (status) => {
      client.end(
        `HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      );
    };
    if (!authenticated(request)) {
      reject('407 Proxy Authentication Required');
      return;
    }
    if (!allowed.has(request.url)) {
      reject('403 Forbidden');
      return;
    }
    if (active >= maxConnections) {
      reject('503 Service Unavailable');
      return;
    }
    active++;
    const upstream = net.createConnection({
      host: config.upstream.host,
      port: config.upstream.port,
    });
    let buffered = Buffer.alloc(0),
      established = false,
      cleaned = false;
    const finish = () => {
      if (cleaned) return;
      cleaned = true;
      active--;
      clearTimeout(deadline);
      upstream.destroy();
      client.destroy();
    };
    const refuse = (status) => {
      if (cleaned) return;
      cleaned = true;
      active--;
      clearTimeout(deadline);
      upstream.destroy();
      client.end(
        `HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
        () => client.destroy(),
      );
    };
    const deadline = setTimeout(finish, 30000);
    client.once('close', finish);
    upstream.once('close', () => {
      if (cleaned) return;
      if (established && upstream.readableEnded) client.end();
      else if (!established) refuse('502 Bad Gateway');
      else finish();
    });
    upstream.on('error', () => {
      if (!established) refuse('502 Bad Gateway');
      else finish();
    });
    upstream.once('connect', () => {
      const auth = Buffer.from(
        config.upstream.username + ':' + config.upstream.password,
      ).toString('base64');
      upstream.write(
        `CONNECT ${request.url} HTTP/1.1\r\nHost: ${request.url}\r\nProxy-Authorization: Basic ${auth}\r\n\r\n`,
      );
    });
    const onHeaders = (data) => {
      buffered = Buffer.concat([buffered, data]);
      if (buffered.length > 16384) {
        refuse('502 Bad Gateway');
        return;
      }
      const boundary = buffered.indexOf('\r\n\r\n');
      if (boundary === -1) return;
      const status = Number(
        buffered
          .toString('latin1', 0, boundary)
          .match(/^HTTP\/1\.[01] (\d{3})/)?.[1],
      );
      if (status !== 200) {
        refuse(
          status >= 400 && status < 600
            ? `${status} Proxy Refused`
            : '502 Bad Gateway',
        );
        return;
      }
      established = true;
      upstream.off('data', onHeaders);
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      const extra = buffered.subarray(boundary + 4);
      if (extra.length) client.write(extra);
      if (head.length) upstream.write(head);
      // Backpressure comes from Node's pipes; encrypted registrar bytes pass
      // unchanged. A disconnect tears down the upstream socket immediately.
      client.pipe(upstream);
      upstream.pipe(client);
    };
    upstream.on('data', onHeaders);
  });
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  const path =
    process.env.RELAY_CONFIG_FILE ?? '/etc/dombot-proxy-relay/config.json';
  const config = JSON.parse(readFileSync(path, 'utf8'));
  if (
    config.upstream.host !== '194.153.254.242' ||
    config.upstream.port !== 12323
  )
    throw Error('Unexpected upstream proxy');
  const tlsOptions = () => ({
    cert: readFileSync(config.certFile),
    key: readFileSync(config.keyFile),
  });
  const server = createRelay(config, tlsOptions());
  process.on('SIGHUP', () => {
    try {
      server.setSecureContext(tlsOptions());
    } catch {
      console.error('TLS reload failed');
    }
  });
  process.on('SIGTERM', () => {
    server.close();
    setTimeout(() => process.exit(0), 31000).unref();
  });
  server.listen(config.port ?? 443, '0.0.0.0', () =>
    console.log(
      JSON.stringify({ event: 'relay-ready', port: config.port ?? 443 }),
    ),
  );
}
