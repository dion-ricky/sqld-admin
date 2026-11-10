"use strict";

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Environment must be set BEFORE importing server.js (config.js validates at module load).
process.env.ALLOW_NO_AUTH = 'false';
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASSWORD = 'test-password';
process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
process.env.SQLD_HOST_SUFFIX = 'local';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqld-auth-tokens-'));
const privateKeyPath = path.join(tmpDir, 'private.pem');
fs.writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
process.env.SQLD_JWT_PRIVATE_KEY_FILE = privateKeyPath;

// Minimal fake sqld: the registry listDatabases query returns one row.
const fakeServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
    if (req.method === 'POST' && pathname === '/v2/pipeline') {
      let parsed = null;
      try { parsed = body ? JSON.parse(body) : null; } catch { parsed = null; }
      const sql = (parsed && parsed.requests && parsed.requests[0] && parsed.requests[0].stmt
        && parsed.requests[0].stmt.sql) || '';

      let rows = [];
      if (/^SELECT name FROM databases ORDER BY name$/i.test(sql.trim())) {
        rows = [[{ type: 'text', value: 'dbsimple' }]];
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        results: [{
          type: 'ok',
          response: {
            type: 'execute',
            result: {
              cols: [{ name: 'name', decltype: 'TEXT' }],
              rows,
              affected_row_count: 0,
              last_insert_rowid: null,
            },
          },
        }],
      }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
});

await new Promise((resolve, reject) => {
  fakeServer.once('error', reject);
  fakeServer.listen(0, '127.0.0.1', resolve);
});
const fakePort = fakeServer.address().port;
process.env.SQLD_URL = `http://127.0.0.1:${fakePort}`;
process.env.SQLD_ADMIN_URL = `http://127.0.0.1:${fakePort}`;

const { server: app } = await import('../server.js');
await new Promise((resolve, reject) => {
  app.once('error', reject);
  app.listen(0, '127.0.0.1', resolve);
});
const appPort = app.address().port;

function basicAuth() {
  return 'Basic ' + Buffer.from('admin:test-password').toString('base64');
}

async function request(pathname, { method = 'GET', body, headers = {}, auth = true } = {}) {
  const finalHeaders = { ...headers };
  if (auth) finalHeaders.Authorization = basicAuth();
  if (method !== 'GET') finalHeaders['Content-Type'] = 'application/json';

  const res = await fetch(`http://127.0.0.1:${appPort}${pathname}`, {
    method,
    headers: finalHeaders,
    body,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, headers: res.headers, json, text };
}

function verifyToken(token) {
  const [headerPart, payloadPart, signaturePart] = token.split('.');
  const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString());
  const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString());
  const valid = crypto.verify(
    null,
    Buffer.from(`${headerPart}.${payloadPart}`),
    publicKey,
    Buffer.from(signaturePart, 'base64url')
  );
  return { header, payload, valid };
}

describe('Auth token routes', () => {
  after(() => {
    app.close();
    fakeServer.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET /api/auth/config reports capabilities without secrets', async () => {
    const res = await request('/api/auth/config');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.signingEnabled, true);
    assert.strictEqual(res.json.appAuthDisabled, false);
    assert.strictEqual(res.json.defaultExpirySeconds, 2592000);
    assert.strictEqual(res.json.minExpirySeconds, 300);
    assert.strictEqual(res.json.maxExpirySeconds, 31536000);
    assert.deepStrictEqual(res.json.expiryOptions, [
      { label: '1 hour', seconds: 3600 },
      { label: '1 day', seconds: 86400 },
      { label: '7 days', seconds: 604800 },
      { label: '30 days', seconds: 2592000 },
      { label: '90 days', seconds: 7776000 },
      { label: '1 year', seconds: 31536000 },
    ]);
    assert.deepStrictEqual(res.json.scopes, {
      allDatabasesWrite: true,
      databaseWrite: true,
      databaseRead: true,
    });
    assert.ok(!res.text.includes(privateKeyPath));
    assert.ok(!res.text.includes('PRIVATE KEY'));
    assert.strictEqual(res.headers.get('cache-control'), 'no-store');
  });

  it('all databases + write returns a full-access token', async () => {
    const res = await request('/api/auth/tokens', {
      method: 'POST',
      body: JSON.stringify({ database: null, access: 'write', expiresInSeconds: 3600 }),
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(typeof res.json.token, 'string');
    assert.strictEqual(typeof res.json.expiresAt, 'string');

    const decoded = verifyToken(res.json.token);
    assert.strictEqual(decoded.valid, true);
    assert.deepStrictEqual(decoded.header, { alg: 'EdDSA', typ: 'JWT' });
    assert.deepStrictEqual(decoded.payload, { exp: decoded.payload.exp });
    assert.strictEqual(res.json.expiresAt, new Date(decoded.payload.exp * 1000).toISOString());

    const headers = JSON.stringify([...res.headers.entries()]);
    assert.ok(!headers.includes(res.json.token));
  });

  it('selected database + write scopes the token with p.rw.ns', async () => {
    const before = Math.floor(Date.now() / 1000);
    const res = await request('/api/auth/tokens', {
      method: 'POST',
      body: JSON.stringify({ database: 'dbsimple', access: 'write', expiresInSeconds: 86400 }),
    });
    const after = Math.floor(Date.now() / 1000);
    assert.strictEqual(res.status, 200);
    const decoded = verifyToken(res.json.token);
    assert.strictEqual(decoded.valid, true);
    assert.deepStrictEqual(decoded.payload.p, { rw: { ns: ['dbsimple'] } });
    assert.ok(decoded.payload.exp >= before + 86400);
    assert.ok(decoded.payload.exp <= after + 86400);
  });

  it('selected database + read scopes the token with p.ro.ns', async () => {
    const res = await request('/api/auth/tokens', {
      method: 'POST',
      body: JSON.stringify({ database: 'dbsimple', access: 'read', expiresInSeconds: 604800 }),
    });
    assert.strictEqual(res.status, 200);
    const decoded = verifyToken(res.json.token);
    assert.strictEqual(decoded.valid, true);
    assert.deepStrictEqual(decoded.payload.p, { ro: { ns: ['dbsimple'] } });
  });

  it('rejects an invalid access value', async () => {
    const res = await request('/api/auth/tokens', {
      method: 'POST',
      body: JSON.stringify({ database: null, access: 'admin', expiresInSeconds: 3600 }),
    });
    assert.strictEqual(res.status, 400);
  });

  it('rejects a missing database field', async () => {
    const res = await request('/api/auth/tokens', {
      method: 'POST',
      body: JSON.stringify({ access: 'write', expiresInSeconds: 3600 }),
    });
    assert.strictEqual(res.status, 400);
  });

  it('rejects all databases + read', async () => {
    const res = await request('/api/auth/tokens', {
      method: 'POST',
      body: JSON.stringify({ database: null, access: 'read', expiresInSeconds: 3600 }),
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.json.error, 'Read-only tokens require a database');
  });

  it('returns 404 for an unregistered database', async () => {
    const res = await request('/api/auth/tokens', {
      method: 'POST',
      body: JSON.stringify({ database: 'dbmissing', access: 'write', expiresInSeconds: 3600 }),
    });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.json.error, 'Database not found');
  });

  it('rejects a non-integer expiry', async () => {
    const res = await request('/api/auth/tokens', {
      method: 'POST',
      body: JSON.stringify({ database: null, access: 'write', expiresInSeconds: 3600.5 }),
    });
    assert.strictEqual(res.status, 400);
  });

  it('rejects an out-of-range expiry', async () => {
    const res = await request('/api/auth/tokens', {
      method: 'POST',
      body: JSON.stringify({ database: null, access: 'write', expiresInSeconds: 31536001 }),
    });
    assert.strictEqual(res.status, 400);
  });

  it('rejects an invalid database name', async () => {
    const res = await request('/api/auth/tokens', {
      method: 'POST',
      body: JSON.stringify({ database: 'bad name', access: 'write', expiresInSeconds: 3600 }),
    });
    assert.strictEqual(res.status, 400);
  });

  it('rejects requests without Basic auth', async () => {
    const res = await request('/api/auth/tokens', {
      method: 'POST',
      auth: false,
      body: JSON.stringify({ database: null, access: 'write', expiresInSeconds: 3600 }),
    });
    assert.strictEqual(res.status, 401);
    assert.match(res.headers.get('www-authenticate') || '', /^Basic/);
  });

  it('rate limits token generation with Retry-After', async () => {
    let limited = null;
    for (let i = 0; i < 15; i += 1) {
      const res = await request('/api/auth/tokens', {
        method: 'POST',
        body: JSON.stringify({ database: null, access: 'write', expiresInSeconds: 3600 }),
      });
      if (res.status === 429) {
        limited = res;
        break;
      }
    }
    assert.ok(limited, 'Expected a 429 after the per-window request limit');
    assert.match(limited.json.error, /Too many token generation requests/);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
  });
});
