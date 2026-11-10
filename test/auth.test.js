"use strict";

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

// Environment must be set BEFORE importing server.js (config.js validates at module load)
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASSWORD = 'test-password';
process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
delete process.env.ALLOW_NO_AUTH;

const { server } = await import('../server.js');

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const port = server.address().port;

function basicAuth(user, password) {
  return 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
}

async function request(pathname, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, { headers });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, headers: res.headers, json, text };
}

describe('Phase 7: Basic auth', () => {
  after(() => {
    server.close();
  });

  it('GET /api/databases without credentials returns 401 with WWW-Authenticate', async () => {
    const res = await request('/api/databases');
    assert.strictEqual(res.status, 401);
    assert.ok(res.json && res.json.error);
    assert.match(res.headers.get('www-authenticate') || '', /^Basic/);
  });

  it('GET / (static) without credentials returns 401', async () => {
    const res = await request('/');
    assert.strictEqual(res.status, 401);
    assert.match(res.headers.get('www-authenticate') || '', /^Basic/);
  });

  it('wrong password returns 401', async () => {
    const res = await request('/', { Authorization: basicAuth('admin', 'wrong-password') });
    assert.strictEqual(res.status, 401);
  });

  it('malformed or non-Basic Authorization returns 401', async () => {
    const headers = [
      'Basic !!!not-base64!!!',
      'Bearer abc',
      'Basic ' + Buffer.from('admin-without-colon').toString('base64'),
      'Basic',
    ];
    for (const header of headers) {
      const res = await request('/', { Authorization: header });
      assert.strictEqual(res.status, 401, `Expected 401 for ${header}`);
    }
  });

  it('correct Basic credentials returns 200 with HTML', async () => {
    const res = await request('/', { Authorization: basicAuth('admin', 'test-password') });
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /^text\/html/);
  });
});
