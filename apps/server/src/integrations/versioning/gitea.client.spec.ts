import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { GiteaClient } from './gitea.client';

describe('Gitea HTTP transport against a local test HTTP server', () => {
  let server: Server,
    client: GiteaClient,
    leaked = false,
    seenAuth = '';
  const original = { ...process.env };
  beforeAll(async () => {
    server = createServer((req, res) => {
      seenAuth = String(req.headers.authorization || '');
      if (req.url === '/api/v1/good') {
        res.setHeader('content-type', 'application/json');
        res.end('{"ok":true}');
      } else if (req.url === '/api/v1/empty') {
        res.statusCode = 204;
        res.end();
      } else if (req.url === '/api/v1/missing') {
        res.statusCode = 404;
        res.end('private response body');
      } else if (req.url === '/api/v1/unauthorized') {
        res.statusCode = 401;
        res.end('credential-shaped error body must not be logged');
      } else if (req.url === '/api/v1/redirect') {
        res.statusCode = 302;
        res.setHeader('location', '/credential-leak');
        res.end();
      } else if (req.url === '/credential-leak') {
        leaked = true;
        res.end('{}');
      } else if (req.url === '/api/v1/bad-json') {
        res.end('not-json');
      } else if (req.url === '/api/v1/oversized') {
        res.end(Buffer.alloc(12 * 1024 * 1024 + 1, 120));
      } else {
        req.socket.destroy();
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    Object.assign(process.env, {
      SOP_VERSION_CAPTURE_ENABLED: 'true',
      SOP_GITEA_SYNC_ENABLED: 'true',
      SOP_GITEA_ALLOW_HTTP: 'true',
      SOP_GITEA_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      SOP_GITEA_TOKEN: 'network-test-only',
      SOP_GITEA_INSTANCE_ID: randomUUID(),
    });
    client = new GiteaClient();
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const key of Object.keys(process.env))
      if (key.startsWith('SOP_') && !(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  });
  it('reads JSON only from the configured origin with a server-side credential', async () => {
    expect(await client.request('/good')).toEqual({ ok: true });
    expect(seenAuth).toBe('token network-test-only');
  });
  it('supports no-content success', async () =>
    expect(await client.request('/empty', 'PUT', {})).toBeUndefined());
  it('returns null only for an explicit missing resource', async () =>
    expect(await client.optional('/missing')).toBeNull());
  it('does not hide an authentication failure as a missing resource', async () => {
    await expect(client.optional('/unauthorized')).rejects.toMatchObject({
      code: 'GITEA_HTTP_401',
      blocked: true,
    });
  });
  it('does not follow a redirect carrying credentials', async () => {
    await expect(client.request('/redirect')).rejects.toMatchObject({
      code: 'GITEA_UNREACHABLE',
    });
    expect(leaked).toBe(false);
  });
  it('does not include response bodies in errors', async () => {
    const error = await client
      .request<never>('/unauthorized')
      .catch((e: Error) => e);
    expect(error.message).toBe('GITEA_HTTP_401');
    expect(error.message).not.toContain('credential-shaped');
  });
  it('rejects malformed responses', async () =>
    expect(client.request('/bad-json')).rejects.toMatchObject({
      code: 'GITEA_INVALID_RESPONSE',
    }));
  it('bounds response size', async () =>
    expect(client.request('/oversized')).rejects.toMatchObject({
      code: 'GITEA_RESPONSE_TOO_LARGE',
      blocked: true,
    }));
  it('retains a retryable error when the connection drops', async () =>
    expect(client.request('/dropped')).rejects.toMatchObject({
      code: 'GITEA_UNREACHABLE',
      blocked: false,
    }));
  it('rejects a protocol-relative API path', async () =>
    expect(client.request('//different.invalid')).rejects.toMatchObject({
      code: 'INVALID_API_PATH',
      blocked: true,
    }));
});
