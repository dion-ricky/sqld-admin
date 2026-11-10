"use strict";

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';

// Environment must be set BEFORE importing server.js (config.js validates at module load).
process.env.ALLOW_NO_AUTH = 'false';
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASSWORD = 'test-password';
process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
process.env.SQLD_URL = 'http://127.0.0.1:1';
process.env.SQLD_ADMIN_URL = 'http://127.0.0.1:1';
const missingKeyPath = path.join(os.tmpdir(), 'sqld-missing-signing-key.pem');
process.env.SQLD_JWT_PRIVATE_KEY_FILE = missingKeyPath;

const { server: app } = await import('../server.js');
await new Promise((resolve, reject) => {
  app.once('error', reject);
  app.listen(0, '127.0.0.1', resolve);
});
const appPort = app.address().port;

function basicAuth() {
  return 'Basic ' + Buffer.from('admin:test-password').toString('base64');
}

async function request(pathname, { method = 'GET', body } = {}) {
  const headers = { Authorization: basicAuth() };
  if (method !== 'GET') headers['Content-Type'] = 'application/json';
  const res = await fetch(`http://127.0.0.1:${appPort}${pathname}`, { method, headers, body });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, headers: res.headers, json, text };
}

describe('Auth token routes without a signing key', () => {
  after(() => {
    app.close();
  });

  it('GET /api/auth/config reports signing as unavailable', async () => {
    const res = await request('/api/auth/config');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.signingEnabled, false);
    assert.strictEqual(res.json.appAuthDisabled, false);
    assert.ok(!res.text.includes(missingKeyPath));
  });

  it('POST /api/auth/tokens returns 503 without leaking the key path', async () => {
    const res = await request('/api/auth/tokens', {
      method: 'POST',
      body: JSON.stringify({ database: null, access: 'write', expiresInSeconds: 3600 }),
    });
    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.json.error, 'Token signing is not configured');
    assert.ok(!res.text.includes(missingKeyPath));
    assert.ok(!res.text.includes('PRIVATE KEY'));
  });
});
