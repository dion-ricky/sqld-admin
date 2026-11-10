"use strict";

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { query, createNamespace, deleteNamespace, forkNamespace } from '../lib/sqld.js';

describe('lib/sqld.js query() Hrana argument encoding', () => {
  let server;
  let port;
  let captured;

  before(async () => {
    server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        captured = {
          method: req.method,
          url: req.url,
          host: req.headers.host,
          authorization: req.headers.authorization,
          body: text ? JSON.parse(text) : null,
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          results: [
            { type: 'ok', response: { type: 'execute', result: {
              cols: [],
              rows: [],
              affected_row_count: 0,
              last_insert_rowid: null
            } } },
            { type: 'ok', response: { type: 'close' } }
          ]
        }));
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));

  it('encodes safe integers as integer cells, floats as float cells, and other types unchanged', async () => {
    captured = null;
    const args = [42, 3.14, -7, 'hello', null, 0n, 9007199254740991n, 9007199254740991];
    const config = {
      SQLD_URL: `http://127.0.0.1:${port}`,
      SQLD_HOST_SUFFIX: 'local',
      SQLD_AUTH_TOKEN: 'user-token'
    };

    await query('testdb', 'SELECT ?, ?, ?, ?, ?, ?, ?, ?', args, config);

    assert.ok(captured, 'request was captured');
    assert.strictEqual(captured.method, 'POST');
    assert.strictEqual(captured.url, '/v2/pipeline');
    assert.strictEqual(captured.host, 'testdb.local');
    assert.strictEqual(captured.authorization, 'Bearer user-token');
    assert.deepStrictEqual(captured.body.requests[0].stmt.args, [
      { type: 'integer', value: '42' },
      { type: 'float', value: 3.14 },
      { type: 'integer', value: '-7' },
      { type: 'text', value: 'hello' },
      { type: 'null', value: null },
      { type: 'integer', value: '0' },
      { type: 'integer', value: '9007199254740991' },
      { type: 'integer', value: '9007199254740991' }
    ]);
    assert.deepStrictEqual(captured.body.requests[1], { type: 'close' });
  });

  it('admin namespace requests use the admin URL host', async () => {
    const config = {
      SQLD_ADMIN_URL: `http://127.0.0.1:${port}`,
      SQLD_HOST_SUFFIX: 'local',
      SQLD_ADMIN_TOKEN: 'admin-token'
    };
    const expectedHost = `127.0.0.1:${port}`;

    captured = null;
    await createNamespace('admintest', config);
    assert.ok(captured, 'create request was captured');
    assert.strictEqual(captured.url, '/v1/namespaces/admintest/create');
    assert.strictEqual(captured.host, expectedHost);
    assert.strictEqual(captured.authorization, 'Basic admin-token');
    assert.notStrictEqual(captured.host, 'local');

    captured = null;
    await deleteNamespace('admintest', config);
    assert.ok(captured, 'delete request was captured');
    assert.strictEqual(captured.url, '/v1/namespaces/admintest');
    assert.strictEqual(captured.host, expectedHost);
    assert.strictEqual(captured.authorization, 'Basic admin-token');
    assert.notStrictEqual(captured.host, 'local');

    captured = null;
    await forkNamespace('admintest', 'admintest2', config);
    assert.ok(captured, 'fork request was captured');
    assert.strictEqual(captured.url, '/v1/namespaces/admintest/fork/admintest2');
    assert.strictEqual(captured.host, expectedHost);
    assert.strictEqual(captured.authorization, 'Basic admin-token');
    assert.notStrictEqual(captured.host, 'local');
  });
});
