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
export function createRelay(
  config,
  tlsOptions,
  connect = net.createConnection,
) {
  const mode = config.mode ?? 'upstream';
  if (
    !['upstream', 'direct', 'migrate'].includes(mode) ||
    !config.token ||
    config.token.length < 32 ||
    (mode !== 'direct' &&
      (!config.upstream?.username || !config.upstream.password)) ||
    (mode === 'direct' && config.upstream) ||
    (mode === 'migrate' &&
      (!config.directToken ||
        config.directToken.length < 32 ||
        config.directToken === config.token))
  )
    throw Error('Invalid relay configuration');
  const maxConnections = Math.max(1, Math.min(16, config.maxConnections ?? 8));
  const expected = digest(
    'Basic ' + Buffer.from('relay:' + config.token).toString('base64'),
  );
  const directExpected =
    mode === 'migrate'
      ? digest(
          'Basic ' +
            Buffer.from('relay:' + config.directToken).toString('base64'),
        )
      : expected;
  const routeFor = (request) => {
    const provided = digest(
      String(request.headers['proxy-authorization'] ?? ''),
    );
    const primary = timingSafeEqual(expected, provided);
    const direct = timingSafeEqual(directExpected, provided);
    if (primary) return mode === 'direct' ? 'direct' : 'upstream';
    return mode === 'migrate' && direct ? 'direct' : null;
  };
  let active = 0;
  const handler = (request, response) => {
    const route = routeFor(request);
    if (request.url !== '/healthz' || !route) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify({ ok: true, active, maxConnections, route }));
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
    const route = routeFor(request);
    if (!route) {
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
    const upstream = connect({
      host:
        route === 'direct' ? request.url.slice(0, -4) : config.upstream.host,
      port: route === 'direct' ? 443 : config.upstream.port,
      family: 4,
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
    const establish = (extra = Buffer.alloc(0)) => {
      established = true;
      upstream.off('data', onHeaders);
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (extra.length) client.write(extra);
      if (head.length) upstream.write(head);
      // The relay forwards opaque TLS bytes and never decrypts registrar traffic.
      client.pipe(upstream);
      upstream.pipe(client);
    };
    upstream.once('connect', () => {
      if (route === 'direct') {
        establish();
        return;
      }
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
      establish(buffered.subarray(boundary + 4));
    };
    if (route === 'upstream') upstream.on('data', onHeaders);
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
    config.mode !== 'direct' &&
    (config.upstream?.host !== '194.153.254.242' ||
      config.upstream?.port !== 12323)
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
