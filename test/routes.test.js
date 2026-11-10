"use strict";

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Environment must be set BEFORE importing server.js (config.js calls validateConfig at module load)
process.env.ALLOW_NO_AUTH = "true";
process.env.SQLD_HOST_SUFFIX = "local";
process.env.PORT = '0';
process.env.HOST = '127.0.0.1';

// ===== In-process fake sqld HTTP server =====
// Mimics sqld namespace mode: user port selects namespace via Host header (<ns>.local),
// admin port manages namespaces via /v1/namespaces/:ns routes.
const namespaces = new Map(); // ns -> { tables: Map, tableRows: Map, data: any[] }
let fakeServer;

const fakeHandler = (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const host = req.headers.host || '';
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const nsFromHost = () => {
    const m = host.match(/^([^.]+)\.local$/);
    return m ? m[1] : null;
  };

  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let parsed;
    try { parsed = body ? JSON.parse(body) : null; } catch { parsed = null; }

    // ---- Admin API: POST /v1/namespaces/:ns/create ----
    if (req.method === 'POST' && /^\/v1\/namespaces\/([^\/]+)\/create$/.test(pathname)) {
      const ns = RegExp.$1;
      if (namespaces.has(ns)) { send(409, { error: 'Namespace already exists' }); return; }
      namespaces.set(ns, { tables: new Map(), tableRows: new Map(), data: [] });
      send(201, { ok: true });
      return;
    }

    // ---- Admin API: DELETE /v1/namespaces/:ns ----
    if (req.method === 'DELETE' && /^\/v1\/namespaces\/([^\/]+)$/.test(pathname)) {
      const ns = RegExp.$1;
      if (namespaces.has(ns)) { namespaces.delete(ns); send(200, { ok: true }); return; }
      send(404, { error: 'Namespace not found' });
      return;
    }

    // ---- Admin API: POST /v1/namespaces/:from/fork/:to ----
    if (req.method === 'POST' && /^\/v1\/namespaces\/([^\/]+)\/fork\/([^\/]+)$/.test(pathname)) {
      const from = RegExp.$1;
      const to = RegExp.$2;
      if (!namespaces.has(from)) { send(404, { error: 'Source namespace not found' }); return; }
      if (namespaces.has(to)) { send(409, { error: 'Target namespace already exists' }); return; }
      const src = namespaces.get(from);
      namespaces.set(to, { tables: new Map(src.tables), data: [...src.data] });
      send(200, { ok: true });
      return;
    }

    // ---- User API: POST /v2/pipeline (Hrana over HTTP) ----
    if (req.method === 'POST' && pathname === '/v2/pipeline') {
      const ns = nsFromHost();
      if (!ns || !namespaces.has(ns)) { send(404, { error: 'Namespace not found' }); return; }
      const nd = namespaces.get(ns);
      const results = [];
      for (const r of (parsed?.requests || [])) {
        if (r.type === 'close') {
          results.push({ type: 'ok', response: { type: 'close' } });
          continue;
        }
        if (r.type === 'execute') {
          const sql = (r.stmt && r.stmt.sql) || '';
          const args = r.stmt && r.stmt.args;
          const u = sql.trim().toUpperCase();
          
          // SQL console support for Phase 5 tests
          if (u === 'SELECT 1 AS N, \'TWO\' AS TXT') {
            // Test query for valid SQL in SQL console
            results.push({ type: 'ok', response: { type: 'execute', result: { cols: [
              { name: 'n', decltype: 'INTEGER' },
              { name: 'txt', decltype: 'TEXT' }
            ], rows: [[{ type: 'integer', value: '1' }, { type: 'text', value: 'two' }]], affected_row_count: 0, last_insert_rowid: null } } });
          } else if (u === 'SELECT \'error\' AS message') {
            // Test query that should return error
            results.push({ type: 'error', error: { message: 'Test error', code: 400 } });
          } else if (u.startsWith('CREATE TABLE IF NOT EXISTS DATABASES')) {
            if (!nd.tables.has('databases')) nd.tables.set('databases', []);
            results.push({ type: 'ok', response: { type: 'execute', result: { cols: [], rows: [], affected_row_count: 0, last_insert_rowid: null } } });
          } else if (u.startsWith('INSERT INTO DATABASES')) {
            const v = args && args[0];
            if (v && v.type === 'text') nd.tables.get('databases').push([v.value]);
            results.push({ type: 'ok', response: { type: 'execute', result: { cols: [], rows: [], affected_row_count: 1, last_insert_rowid: null } } });
          } else if (u.startsWith('SELECT NAME FROM DATABASES')) {
            const rows = (nd.tables.get('databases') || []).map(r => [r[0]]);
            results.push({ type: 'ok', response: { type: 'execute', result: { cols: [{ name: 'name', decltype: 'TEXT' }], rows, affected_row_count: 0, last_insert_rowid: null } } });
          } else if (u.startsWith('DELETE FROM DATABASES')) {
            const v = args && args[0];
            let count = 0;
            if (v && v.type === 'text') {
              const tbl = nd.tables.get('databases');
              const i = tbl.findIndex(r => r[0] === v.value);
              if (i >= 0) { tbl.splice(i, 1); count = 1; }
            }
            results.push({ type: 'ok', response: { type: 'execute', result: { cols: [], rows: [], affected_row_count: count, last_insert_rowid: null } } });
          } else if (u === 'SELECT 1') {
            results.push({ type: 'ok', response: { type: 'execute', result: { cols: [], rows: [[]], affected_row_count: 0, last_insert_rowid: null } } });
          } else if (u === 'SELECT NAME FROM SQLITE_SCHEMA WHERE TYPE=\'TABLE\' AND NAME NOT LIKE \'SQLITE_%\' ORDER BY NAME') {
            // List tables in the namespace
            const tableNames = Array.from(nd.tables.keys());
            const rows = tableNames.map(name => [name]);
            results.push({ type: 'ok', response: { type: 'execute', result: { cols: [{ name: 'name', decltype: 'TEXT' }], rows, affected_row_count: 0, last_insert_rowid: null } } });
          } else if (/^SELECT NAME FROM SQLITE_SCHEMA WHERE TYPE='TABLE' AND NAME = \?$/i.test(u)) {
            // Check if a specific table exists (parameterized name)
            const tableArg = args && args[0] && args[0].value;
            if (typeof tableArg === 'string') {
              const exists = nd.tables.has(tableArg);
              const rows = exists ? [[tableArg]] : [];
              results.push({ type: 'ok', response: { type: 'execute', result: { cols: [{ name: 'name', decltype: 'TEXT' }], rows, affected_row_count: 0, last_insert_rowid: null } } });
            } else {
              results.push({ type: 'error', error: { message: `Invalid table existence query`, code: 400 } });
            }
          } else if (u.startsWith('PRAGMA TABLE_INFO("')) {
            // Get table schema
            const match = sql.match(/^PRAGMA table_info\("([^"]+)"\)/i);
            if (match) {
              const tableName = match[1];
              if (nd.tables.has(tableName)) {
                const columns = nd.tables.get(tableName);
                // Format: cid, name, type, notnull, dflt_value, pk
                const rows = columns.map((col, cid) => [
                  cid,           // cid (column ID)
                  col.name,      // name
                  col.type,      // type
                  col.notNull ? 1 : 0,  // notnull
                  col.defaultValue || null,  // dflt_value
                  col.primaryKey ? 1 : 0     // pk
                ]);
                results.push({ type: 'ok', response: { type: 'execute', result: { cols: [
                  { name: 'cid', decltype: 'INTEGER' },
                  { name: 'name', decltype: 'TEXT' },
                  { name: 'type', decltype: 'TEXT' },
                  { name: 'notnull', decltype: 'INTEGER' },
                  { name: 'dflt_value', decltype: 'TEXT' },
                  { name: 'pk', decltype: 'INTEGER' }
                ], rows, affected_row_count: 0, last_insert_rowid: null } } });
              } else {
                results.push({ type: 'error', error: { message: `Table not found: ${tableName}`, code: 404 } });
              }
            } else {
              results.push({ type: 'error', error: { message: `Invalid PRAGMA syntax`, code: 400 } });
            }
          } else if (u.startsWith('CREATE TABLE "')) {
            // Create table
              const match = sql.match(/^CREATE TABLE "([^"]+)" \((.*)\)$/i);
            if (match) {
              const tableName = match[1];
              const columnsDef = match[2];
              
              // Parse column definitions from SQL
              const columnDefs = columnsDef.split(', ').map(def => {
                // Extract column name and properties
                const nameMatch = def.match(/^\"([^\"]+)\"/);
                if (!nameMatch) return null;
                
                const colName = nameMatch[1];
                const rest = def.substring(nameMatch[0].length).trim();
                
                const column = {
                  name: colName,
                  type: 'TEXT', // Default type
                  primaryKey: false,
                  notNull: false,
                  defaultValue: undefined
                };
                
                // Extract type
                const typeMatch = rest.match(/^([^\s]+)/);
                if (typeMatch) {
                  column.type = typeMatch[0];
                }
                
                // Check for NOT NULL
                if (rest.includes('NOT NULL')) {
                  column.notNull = true;
                }
                
                // Check for PRIMARY KEY
                if (rest.includes('PRIMARY KEY')) {
                  column.primaryKey = true;
                }
                
                // Check for DEFAULT
                const defaultMatch = rest.match(/DEFAULT\s+([^\s]+)/);
                if (defaultMatch) {
                  column.defaultValue = defaultMatch[1];
                }
                
                return column;
              }).filter(col => col !== null);
              
              if (columnDefs.length > 0) {
                nd.tables.set(tableName, columnDefs);
                nd.tableRows.set(tableName, []);
                results.push({ type: 'ok', response: { type: 'execute', result: { cols: [], rows: [], affected_row_count: 1, last_insert_rowid: null } } });
              } else {
                results.push({ type: 'error', error: { message: `Invalid CREATE TABLE statement`, code: 400 } });
              }
            } else {
              results.push({ type: 'error', error: { message: `Invalid CREATE TABLE syntax`, code: 400 } });
            }
          } else if (u.startsWith('ALTER TABLE "')) {
            // Handle ALTER TABLE operations (RENAME TO and ADD COLUMN)
            if (u.includes('RENAME TO')) {
              // Rename table
              const match = sql.match(/^ALTER TABLE "([^"]+)" RENAME TO "([^"]+)"$/i);
              if (match) {
                const oldTableName = match[1];
                const newTableName = match[2];
                
                if (nd.tables.has(oldTableName)) {
                  const tableData = nd.tables.get(oldTableName);
                  nd.tables.set(newTableName, tableData);
                  nd.tables.delete(oldTableName);
                  results.push({ type: 'ok', response: { type: 'execute', result: { cols: [], rows: [], affected_row_count: 1, last_insert_rowid: null } } });
                } else {
                  results.push({ type: 'error', error: { message: `Table not found: ${oldTableName}`, code: 404 } });
                }
              } else {
                results.push({ type: 'error', error: { message: `Invalid ALTER TABLE RENAME syntax`, code: 400 } });
              }
            } else if (u.includes('ADD COLUMN')) {
              // Add column to table
              const match = sql.match(/^ALTER TABLE "([^"]+)" ADD COLUMN "([^"]+)"/i);
              if (match) {
                const tableName = match[1];
                const columnName = match[2];
                
                if (nd.tables.has(tableName)) {
                  const columns = nd.tables.get(tableName);
                  // Add a new column (simplified: default TEXT type)
                  const newColumn = {
                    name: columnName,
                    type: 'TEXT',
                    primaryKey: false,
                    notNull: false,
                    defaultValue: undefined
                  };
                  columns.push(newColumn);
                  results.push({ type: 'ok', response: { type: 'execute', result: { cols: [], rows: [], affected_row_count: 1, last_insert_rowid: null } } });
                } else {
                  results.push({ type: 'error', error: { message: `Table not found: ${tableName}`, code: 404 } });
                }
              } else {
                results.push({ type: 'error', error: { message: `Invalid ALTER TABLE ADD COLUMN syntax`, code: 400 } });
              }
            } else {
              results.push({ type: 'error', error: { message: `Unsupported ALTER TABLE: ${u}`, code: 400 } });
            }
          } else if (u.startsWith('DROP TABLE "')) {
            // Drop table
              const match = sql.match(/^DROP TABLE "([^"]+)"$/i);
            if (match) {
              const tableName = match[1];
              if (nd.tables.has(tableName)) {
                nd.tables.delete(tableName);
                results.push({ type: 'ok', response: { type: 'execute', result: { cols: [], rows: [], affected_row_count: 1, last_insert_rowid: null } } });
              } else {
                results.push({ type: 'error', error: { message: `Table not found: ${tableName}`, code: 404 } });
              }
            } else {
              results.push({ type: 'error', error: { message: `Invalid DROP TABLE syntax`, code: 400 } });
            }
          } else if (u.startsWith('SELECT * FROM "')) {
            // Select paginated rows from a table
            const match = sql.match(/^SELECT \* FROM "([^"]+)"/i);
            if (match) {
              const tableName = match[1];
              if (nd.tables.has(tableName)) {
                const columns = nd.tables.get(tableName);
                const allRows = nd.tableRows.get(tableName) || [];
                const limitArg = args && args[0];
                const offsetArg = args && args[1];
                let limit = limitArg ? Number(limitArg.value) : 50;
                let offset = offsetArg ? Number(offsetArg.value) : 0;
                if (!Number.isFinite(limit) || limit <= 0) limit = 50;
                if (!Number.isFinite(offset) || offset < 0) offset = 0;
                const paginated = allRows.slice(offset, offset + limit);
                const cols = columns.map(col => ({ name: col.name, decltype: col.type }));
                results.push({ type: 'ok', response: { type: 'execute', result: { cols, rows: paginated, affected_row_count: 0, last_insert_rowid: null } } });
              } else {
                results.push({ type: 'error', error: { message: `Table not found: ${tableName}`, code: 404 } });
              }
            } else {
              results.push({ type: 'error', error: { message: `Invalid SELECT syntax`, code: 400 } });
            }
          } else if (u.startsWith('SELECT COUNT(*) FROM "')) {
            // Count all rows in a table
            const match = sql.match(/^SELECT COUNT\(\*\) FROM "([^"]+)"/i);
            if (match) {
              const tableName = match[1];
              if (nd.tables.has(tableName)) {
                const count = (nd.tableRows.get(tableName) || []).length;
                results.push({ type: 'ok', response: { type: 'execute', result: { cols: [{ name: 'count', decltype: 'INTEGER' }], rows: [[{ type: 'integer', value: String(count) }]], affected_row_count: 0, last_insert_rowid: null } } });
              } else {
                results.push({ type: 'error', error: { message: `Table not found: ${tableName}`, code: 404 } });
              }
            } else {
              results.push({ type: 'error', error: { message: `Invalid COUNT syntax`, code: 400 } });
            }
          } else {
            results.push({ type: 'error', error: { message: `Unsupported: ${sql}`, code: 400 } });
          }
        }
      }
      send(200, { results });
      return;
    }

    send(404, { error: 'not found' });
  });
};

await new Promise((resolve) => {
  fakeServer = http.createServer(fakeHandler);
  fakeServer.listen(0, '127.0.0.1', resolve);
});
const fakePort = fakeServer.address().port;

// Update environment variables before importing server.js
process.env.SQLD_URL = `http://127.0.0.1:${fakePort}`;
process.env.SQLD_ADMIN_URL = `http://127.0.0.1:${fakePort}`;

// Import server.js synchronously with updated environment variables
const { server: app, startup } = await import('../server.js');
await startup();
const appPort = app.address().port;

// Simple fetch to the ephemeral app port
async function fetchJson(path, opts = {}) {
  const method = opts.method || 'GET';
  const headers = { ...(opts.headers || {}) };
  const hasContentType = Object.keys(headers).some((name) => name.toLowerCase() === 'content-type');
  if (method !== 'GET' && !hasContentType) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`http://127.0.0.1:${appPort}${path}`, {
    method,
    headers,
    body: opts.body
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, headers: res.headers, json, text };
}

// Raw request helper for paths that URL parsing would otherwise normalize.
function rawGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: appPort,
      path,
      method: 'GET',
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.end();
  });
}

// Raw chunked request helper: writes chunks without Content-Length so Node
// sends Transfer-Encoding: chunked, exercising the streaming body-limit path.
function rawRequest(method, path, headers, chunks) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: appPort,
      path,
      method,
      headers,
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch {}
        resolve({ status: res.statusCode, text, json });
      });
    });
    req.on('error', reject);
    for (const chunk of chunks) {
      req.write(chunk);
    }
    req.end();
  });
}

// JSON payload above the 1 MB request-body limit.
function oversizedJson(obj) {
  return JSON.stringify({ ...obj, pad: 'x'.repeat(2 * 1024 * 1024) });
}

// Admin request directly to fake sqld (bypasses server.js)
async function fakeAdmin(method, path, body) {
  const res = await fetch(`http://127.0.0.1:${fakePort}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, json, text };
}

describe('Phase 2: Registry + Database Routes', () => {
  after(async () => {
    app.close();
    fakeServer.close();
  });

  // 1: Create database → appears in list
  it('create database appears in list', async () => {
    const res = await fetchJson('/api/databases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'dbcreate1' })
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.name, 'dbcreate1');

    const list = await fetchJson('/api/databases');
    assert.deepStrictEqual(list.json, ['dbcreate1']);
  });

  it('manager-registry excluded from list', async () => {
    const list = await fetchJson('/api/databases');
    assert.ok(!list.json.includes('manager-registry'));
  });

  // 2: Duplicate create → 409
  it('duplicate create returns 409', async () => {
    const res = await fetchJson('/api/databases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'dbcreate1' })
    });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.json.error, 'Database already registered');
  });

  // Existing but unregistered namespace → 409 and not adopted
  it('create with existing unregistered namespace returns 409 and does not auto-adopt', async () => {
    await fakeAdmin('POST', '/v1/namespaces/dborphan/create', {});
    const res = await fetchJson('/api/databases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'dborphan' })
    });
    assert.strictEqual(res.status, 409);
    assert.match(res.json.error, /already exists|Add existing/i);

    const list = await fetchJson('/api/databases');
    assert.ok(!list.json.includes('dborphan'));
  });

  // 3: Reserved manager-registry → 400; excluded from list
  it('reserved manager-registry returns 400', async () => {
    const res = await fetchJson('/api/databases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'manager-registry' })
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.json.error);

    const list = await fetchJson('/api/databases');
    assert.ok(!list.json.includes('manager-registry'));
  });

  // 4: Invalid names → 400
  it('invalid names return 400', async () => {
    for (const name of ['bad name', 'sqlite_x', '', 'UPPERCASE']) {
      const res = await fetchJson('/api/databases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      assert.strictEqual(res.status, 400, `Expected 400 for ${JSON.stringify(name)}`);
      assert.ok(res.json.error);
    }
  });

  // 5: Adopt existing / missing / already-registered
  it('adopt existing namespace registers it', async () => {
    await fakeAdmin('POST', '/v1/namespaces/dbadoptexist/create', {});
    const res = await fetchJson('/api/databases/adopt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'dbadoptexist' })
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.name, 'dbadoptexist');

    const list = await fetchJson('/api/databases');
    assert.ok(list.json.includes('dbadoptexist'));
  });

  it('adopt missing namespace returns 404', async () => {
    const res = await fetchJson('/api/databases/adopt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'dbadoptmissing' })
    });
    assert.strictEqual(res.status, 404);
    assert.ok(res.json.error);
  });

  it('adopt already-registered returns 409', async () => {
    const res = await fetchJson('/api/databases/adopt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'dbadoptexist' })
    });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.json.error, 'Database already registered');
  });

  // 6: Rename happy path
  it('rename happy path: fork → verify → delete old → update registry', async () => {
    await fetchJson('/api/databases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'dbrenameold' })
    });

    const res = await fetchJson('/api/databases/dbrenameold', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'dbrenamenew' })
    });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.json, { old: 'dbrenameold', new: 'dbrenamenew' });

    const list = await fetchJson('/api/databases');
    assert.ok(!list.json.includes('dbrenameold'));
    assert.ok(list.json.includes('dbrenamenew'));
  });

  // 7: Rename fork failure → 502, old intact, new not created
  it('rename fork failure returns 502 and leaves data intact', async () => {
    // Create in registry (also creates in fake sqld)
    await fetchJson('/api/databases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'dbforkfail' })
    });
    // Delete directly from fake sqld (not from registry) → source missing for fork
    await fakeAdmin('DELETE', '/v1/namespaces/dbforkfail', null);

    const res = await fetchJson('/api/databases/dbforkfail', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'dbforkfailtarget' })
    });
    assert.strictEqual(res.status, 502);
    assert.ok(res.json.error);

    // Old still in registry, new not created
    const list = await fetchJson('/api/databases');
    assert.ok(list.json.includes('dbforkfail'));
    assert.ok(!list.json.includes('dbforkfailtarget'));
  });

  // 8: Fork/duplicate + delete
  it('fork duplicates database', async () => {
    await fetchJson('/api/databases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'dbforkfrom' })
    });
    const res = await fetchJson('/api/databases/dbforkfrom/fork', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'dbforkto' })
    });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.json, { from: 'dbforkfrom', to: 'dbforkto' });

    const list = await fetchJson('/api/databases');
    assert.ok(list.json.includes('dbforkfrom'));
    assert.ok(list.json.includes('dbforkto'));
  });

  it('delete removes database; delete missing returns 404', async () => {
    await fetchJson('/api/databases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'dbdeleteme' })
    });
    const del = await fetchJson('/api/databases/dbdeleteme', { method: 'DELETE' });
    assert.strictEqual(del.status, 200);
    assert.strictEqual(del.json.name, 'dbdeleteme');

    const list = await fetchJson('/api/databases');
    assert.ok(!list.json.includes('dbdeleteme'));

    const del2 = await fetchJson('/api/databases/dbdeleteme', { method: 'DELETE' });
    assert.strictEqual(del2.status, 404);
  });

  // Oversized body → 413
  it('oversized body returns 413', async () => {
    const bigBody = JSON.stringify({ name: 'x'.repeat(2 * 1024 * 1024) });
    const res = await fetchJson('/api/databases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bigBody
    });
    assert.strictEqual(res.status, 413);
  });

  // Unregistered :db → 404
  it('unregistered database returns 404', async () => {
    const res = await fetchJson('/api/databases/dbnosuchdb', { method: 'DELETE' });
    assert.strictEqual(res.status, 404);
  });

  // Table routes

  // Create dbsimple database for table tests
  it('setup: create dbsimple database', async () => {
    const res = await fetchJson('/api/databases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'dbsimple' })
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.name, 'dbsimple');
  });

  // 1: Create table → 200 + appears in table list
  it('create table appears in table list', async () => {
    const res = await fetchJson('/api/databases/dbsimple/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table: 'users',
        columns: {
          id: 'INTEGER PRIMARY KEY',
          name: 'TEXT NOT NULL',
          email: 'TEXT'
        }
      })
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.table, 'users');

    // List tables should now contain 'users'
    const list = await fetchJson('/api/databases/dbsimple/tables');
    assert.strictEqual(list.status, 200);
    assert.ok(Array.isArray(list.json) && list.json.length === 1 && list.json[0] === 'users');
  });

  // 2: List tables → empty initially
  it('list tables empty initially', async () => {
    const dbName = 'dbempty' + Date.now(); // Use unique name to avoid conflicts
    // Create database first
    await fetchJson('/api/databases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: dbName })
    });

    const res = await fetchJson(`/api/databases/${dbName}/tables`);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.json) && res.json.length === 0);
  });

  // 3: Create table with hostile name (`a"; DROP TABLE x;--`) → 400
  it('create table with hostile name returns 400', async () => {
    const res = await fetchJson('/api/databases/dbsimple/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table: 'a"; DROP TABLE x;--',
        columns: { id: 'INTEGER' }
      })
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.json.error);
  });

  // 4: Create table with invalid column name → 400
  it('create table with invalid column name returns 400', async () => {
    const res = await fetchJson('/api/databases/dbsimple/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table: 'users',
        columns: {
          'bad name': 'TEXT' // Invalid column name (contains space)
        }
      })
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.json.error);
  });

  // 5: Create table with invalid column type → 400
  it('create table with invalid column type returns 400', async () => {
    const res = await fetchJson('/api/databases/dbsimple/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table: 'users',
        columns: {
          id: 'INVALID_TYPE'
        }
      })
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.json.error);
  });

  // 6: Get schema → 200 + columns
  it('get table schema returns columns', async () => {
    const res = await fetchJson('/api/databases/dbsimple/tables/users');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.json.columns));
    assert.strictEqual(res.json.columns.length, 3);
    assert.ok(res.json.columns.find(col => col.name === 'id'));
    assert.ok(res.json.columns.find(col => col.name === 'name'));
    assert.ok(res.json.columns.find(col => col.name === 'email'));
  });

  // 7: Rename table → 200 + old gone, new present
  it('rename table happy path', async () => {
    // First ensure we have a table to rename
    await fetchJson('/api/databases/dbsimple/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table: 'oldname',
        columns: { id: 'INTEGER' }
      })
    });

    const res = await fetchJson('/api/databases/dbsimple/tables/oldname', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'newname' })
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.old, 'oldname');
    assert.strictEqual(res.json.new, 'newname');

    // Verify old table is gone
    const oldRes = await fetchJson('/api/databases/dbsimple/tables/oldname');
    assert.strictEqual(oldRes.status, 404);

    // Verify new table exists
    const newRes = await fetchJson('/api/databases/dbsimple/tables/newname');
    assert.strictEqual(newRes.status, 200);
  });

  // 8: Rename table hostile new name → 400
  it('rename table with hostile new name returns 400', async () => {
    const res = await fetchJson('/api/databases/dbsimple/tables/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'malicious; DROP TABLE users;--' })
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.json.error);
  });

  // 9: Add column → 200 + appears in schema
  it('add column to table', async () => {
    // Add a new column to the users table
    const res = await fetchJson('/api/databases/dbsimple/tables/users/columns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'age',
        type: 'INTEGER'
      })
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.column.name, 'age');
    assert.strictEqual(res.json.column.type, 'INTEGER');

    // Verify column appears in schema
    const schema = await fetchJson('/api/databases/dbsimple/tables/users');
    assert.strictEqual(schema.status, 200);
    assert.ok(schema.json.columns.find(col => col.name === 'age'));
  });

  // 10: Add column hostile name → 400
  it('add column with hostile name returns 400', async () => {
    const res = await fetchJson('/api/databases/dbsimple/tables/users/columns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'malicious; DROP TABLE users;--',
        type: 'INTEGER'
      })
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.json.error);
  });

  // 11: Drop table → 200 + gone from list
  it('drop table removes it', async () => {
    // First ensure we have a table to drop
    await fetchJson('/api/databases/dbsimple/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table: 'todelete',
        columns: { id: 'INTEGER' }
      })
    });

    const res = await fetchJson('/api/databases/dbsimple/tables/todelete', {
      method: 'DELETE'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.table, 'todelete');

    // Verify table is gone from list
    const list = await fetchJson('/api/databases/dbsimple/tables');
    assert.strictEqual(list.status, 200);
    assert.ok(Array.isArray(list.json) && list.json.length === 2 && list.json.includes('users') && list.json.includes('newname')); // Only remaining tables
  });

  // 12: Drop missing table → 404
  it('drop missing table returns 404', async () => {
    const res = await fetchJson('/api/databases/dbsimple/tables/nonexistent', {
      method: 'DELETE'
    });
    assert.strictEqual(res.status, 404);
    assert.ok(res.json.error);
  });

  // 13: Unregistered :db → 404
  it('unregistered database returns 404 for table routes', async () => {
    const res = await fetchJson('/api/databases/unknowndb/tables');
    assert.strictEqual(res.status, 404);
    assert.ok(res.json.error);
  });

  // 14: manager-registry as :db → 400
  it('manager-registry as database returns 400', async () => {
    const res = await fetchJson('/api/databases/manager-registry/tables');
    assert.strictEqual(res.status, 400);
    assert.ok(res.json.error);
  });

  // Phase 5: SQL Console
  describe('Phase 5: SQL Console', () => {
    it('setup: create dbsql database for SQL console tests', async () => {
      const res = await fetchJson('/api/databases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'dbsql' })
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.name, 'dbsql');
    });
    
    // Test: Valid SQL returns 200 with {columns, rows, affected}
    it('valid SQL returns 200 with {columns, rows, affected}', async () => {
      const res = await fetchJson('/api/databases/dbsql/sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: 'SELECT 1 AS n, \'two\' AS txt' })
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.json.columns);
      assert.ok(res.json.rows);
      assert.ok(typeof res.json.affected === 'number');
    });
    
    // Test: Invalid SQL returns 502 with sqld error message
    it('invalid SQL returns 502 with sqld error message', async () => {
      const res = await fetchJson('/api/databases/dbsql/sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: 'INVALID SQL SYNTAX' })
      });
      assert.strictEqual(res.status, 502);
      assert.ok(res.json.error);
    });
    
    // Test: Unregistered database returns 404
    it('unregistered database returns 404', async () => {
      const res = await fetchJson('/api/databases/unknowndb/sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: 'SELECT 1' })
      });
      assert.strictEqual(res.status, 404);
      assert.ok(res.json.error);
    });
    
    // Test: Reserved manager-registry returns 400
    it('reserved manager-registry returns 400', async () => {
      const res = await fetchJson('/api/databases/manager-registry/sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: 'SELECT 1' })
      });
      assert.strictEqual(res.status, 400);
      assert.ok(res.json.error);
    });
    
    // Test: Invalid db name format returns 400
    it('invalid db name format returns 400', async () => {
      for (const dbName of ['bad name', 'sqlite_x', 'UPPERCASE']) {
        const res = await fetchJson(`/api/databases/${dbName}/sql`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql: 'SELECT 1' })
        });
        assert.strictEqual(res.status, 400, `Expected 400 for ${JSON.stringify(dbName)}`);
        assert.ok(res.json.error);
      }
    });
  });

  // Phase 4: Rows route
  describe('Phase 4: Rows route', () => {
    it('setup: create dbrows database and people table with typed rows', async () => {
      const dbRes = await fetchJson('/api/databases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'dbrows' })
      });
      assert.strictEqual(dbRes.status, 200);

      const tableRes = await fetchJson('/api/databases/dbrows/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table: 'people',
          columns: {
            id: 'INTEGER',
            name: 'TEXT',
            score: 'REAL',
            data: 'BLOB',
            note: 'TEXT'
          }
        })
      });
      assert.strictEqual(tableRes.status, 200);

      // Insert typed rows directly into the fake sqld store
      const ns = namespaces.get('dbrows');
      const rows = ns.tableRows.get('people');
      rows.push([
        { type: 'integer', value: '1' },
        { type: 'text', value: 'Alice' },
        { type: 'float', value: 95.5 },
        { type: 'blob', base64: 'aGVsbG8=' },
        { type: 'null' }
      ]);
      rows.push([
        { type: 'integer', value: '2' },
        { type: 'text', value: 'Bob' },
        { type: 'float', value: 87.2 },
        { type: 'blob', base64: 'd29ybGQ=' },
        { type: 'text', value: 'hello' }
      ]);
      rows.push([
        { type: 'integer', value: '3' },
        { type: 'text', value: 'Carol' },
        { type: 'float', value: 92.1 },
        { type: 'null' },
        { type: 'text', value: 'world' }
      ]);
    });

    it('GET rows returns columns, rows, total, limit, offset', async () => {
      const res = await fetchJson('/api/databases/dbrows/tables/people/rows');
      assert.strictEqual(res.status, 200);
      assert.ok(res.json);
      assert.strictEqual(res.json.total, 3);
      assert.strictEqual(res.json.limit, 50);
      assert.strictEqual(res.json.offset, 0);
      assert.ok(Array.isArray(res.json.columns));
      assert.strictEqual(res.json.columns.length, 5);
      assert.strictEqual(res.json.columns[0], 'id');
      assert.ok(Array.isArray(res.json.rows));
      assert.strictEqual(res.json.rows.length, 3);
    });

    it('limit clamping: limit=0 uses default 50', async () => {
      const res = await fetchJson('/api/databases/dbrows/tables/people/rows?limit=0');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.limit, 50);
    });

    it('limit clamping: limit=1000 clamped to 500', async () => {
      const res = await fetchJson('/api/databases/dbrows/tables/people/rows?limit=1000');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.limit, 500);
    });

    it('limit clamping: limit=25 returns all 3 rows (fewer than 25)', async () => {
      const res = await fetchJson('/api/databases/dbrows/tables/people/rows?limit=25');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.limit, 25);
      assert.strictEqual(res.json.rows.length, 3);
    });

    it('offset clamping: negative offset uses 0', async () => {
      const res = await fetchJson('/api/databases/dbrows/tables/people/rows?offset=-5');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.offset, 0);
      assert.strictEqual(res.json.rows.length, 3);
    });

    it('offset: offset=1 returns rows starting at index 1', async () => {
      const res = await fetchJson('/api/databases/dbrows/tables/people/rows?limit=2&offset=1');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.limit, 2);
      assert.strictEqual(res.json.offset, 1);
      assert.strictEqual(res.json.rows.length, 2);
      assert.strictEqual(res.json.rows[0][0], 2); // Bob's id
    });

    it('offset: offset beyond data returns empty rows', async () => {
      const res = await fetchJson('/api/databases/dbrows/tables/people/rows?offset=100');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.offset, 100);
      assert.strictEqual(res.json.rows.length, 0);
    });

    it('malformed offset uses default 0 instead of passing through to sqld', async () => {
      const res = await fetchJson('/api/databases/dbrows/tables/people/rows?offset=abc');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.offset, 0);
      assert.strictEqual(res.json.rows.length, 3);
    });

    it('malformed limit uses default 50 instead of passing through to sqld', async () => {
      const res = await fetchJson('/api/databases/dbrows/tables/people/rows?limit=abc');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.limit, 50);
      assert.strictEqual(res.json.rows.length, 3);
    });

    it('value decoding: null, integer, float, text, blob', async () => {
      const res = await fetchJson('/api/databases/dbrows/tables/people/rows?limit=1');
      assert.strictEqual(res.status, 200);
      const row = res.json.rows[0];
      assert.strictEqual(row[0], 1);            // integer -> number
      assert.strictEqual(row[1], 'Alice');      // text -> string
      assert.strictEqual(row[2], 95.5);         // float -> number
      assert.strictEqual(row[4], null);         // null -> null
      assert.deepStrictEqual(row[3], { blob: true, bytes: 5 }); // blob -> {blob, bytes} with decoded length
      assert.strictEqual(row[3].base64, undefined);
      assert.strictEqual(row[3].value, undefined);
    });

    it('table not found returns 404', async () => {
      const res = await fetchJson('/api/databases/dbrows/tables/nonexistent/rows');
      assert.strictEqual(res.status, 404);
      assert.ok(res.json.error);
    });

    it('unregistered database returns 404', async () => {
      const res = await fetchJson('/api/databases/unknowndb/tables/people/rows');
      assert.strictEqual(res.status, 404);
      assert.ok(res.json.error);
    });

    it('manager-registry as database returns 400', async () => {
      const res = await fetchJson('/api/databases/manager-registry/tables/people/rows');
      assert.strictEqual(res.status, 400);
      assert.ok(res.json.error);
    });
  });

  describe('Phase 7: request hardening', () => {
    it('mismatched Origin returns 403', async () => {
      const res = await fetchJson('/api/databases', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://evil.example',
        },
        body: JSON.stringify({ name: 'dboriginbad' }),
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.json.error, 'Origin header mismatch');
    });

    it('matching Origin is allowed', async () => {
      const res = await fetchJson('/api/databases', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: `http://127.0.0.1:${appPort}`,
        },
        body: JSON.stringify({ name: 'dborigingood' }),
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.name, 'dborigingood');
    });

    it('non-JSON Content-Type returns 400', async () => {
      const res = await fetchJson('/api/databases', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ name: 'dbplaintext' }),
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.json.error, 'Content-Type must be application/json');
    });

    it('API responses include security headers', async () => {
      const res = await fetchJson('/api/databases');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
      assert.strictEqual(res.headers.get('content-security-policy'), "default-src 'self'");
      assert.strictEqual(res.headers.get('cache-control'), 'no-store');
    });

    it('path traversal attempts return 404 without leaking server source', async () => {
      for (const path of ['/..%2Fserver.js', '/style.css/../../server.js']) {
        const res = await rawGet(path);
        assert.strictEqual(res.status, 404, `Expected 404 for ${path}`);
        assert.ok(!res.text.includes('createServer'), `Leaked server source for ${path}`);
      }
    });
  });

  describe('Static font assets', () => {
    it('serves the Recursive woff2 with font MIME and immutable cache', async () => {
      const res = await fetch(`http://127.0.0.1:${appPort}/fonts/recursive-latin-var.woff2`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers.get('content-type').startsWith('font/woff2'));
      const cacheControl = res.headers.get('cache-control');
      assert.ok(cacheControl.includes('max-age=31536000'));
      assert.ok(cacheControl.includes('immutable'));
      const magic = Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString('ascii');
      assert.strictEqual(magic, 'wOF2');
    });

    it('serves the OFL license as plain text', async () => {
      const res = await fetchJson('/fonts/OFL.txt');
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers.get('content-type').startsWith('text/plain'));
      assert.ok(res.text.includes('SIL OPEN FONT LICENSE'));
    });

    it('returns 404 for unknown font files', async () => {
      const res = await fetchJson('/fonts/missing.woff2');
      assert.strictEqual(res.status, 404);
    });

    it('returns 404 for non-font files and traversal under /fonts', async () => {
      const htmlRes = await fetchJson('/fonts/evil.html');
      assert.strictEqual(htmlRes.status, 404);

      for (const path of ['/fonts/..%2Fserver.js', '/fonts/%2E%2E%2Fserver.js']) {
        const res = await rawGet(path);
        assert.strictEqual(res.status, 404, `Expected 404 for ${path}`);
        assert.ok(!res.text.includes('createServer'), `Leaked server source for ${path}`);
      }
    });
  });

  describe('Phase 7: body limit on table routes', () => {
    it('setup: create dbbigbody database and bigtable', async () => {
      const dbRes = await fetchJson('/api/databases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'dbbigbody' })
      });
      assert.strictEqual(dbRes.status, 200);

      const tableRes = await fetchJson('/api/databases/dbbigbody/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: 'bigtable', columns: { id: 'INTEGER' } })
      });
      assert.strictEqual(tableRes.status, 200);
    });

    it('create table with oversized Content-Length body returns 413', async () => {
      const res = await fetchJson('/api/databases/dbbigbody/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: oversizedJson({ table: 'huge', columns: { id: 'INTEGER' } })
      });
      assert.strictEqual(res.status, 413);
      assert.strictEqual(res.json.error, 'Request body too large');
    });

    it('rename table with oversized Content-Length body returns 413', async () => {
      const res = await fetchJson('/api/databases/dbbigbody/tables/bigtable', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: oversizedJson({ name: 'bigtable_renamed' })
      });
      assert.strictEqual(res.status, 413);
      assert.strictEqual(res.json.error, 'Request body too large');
    });

    it('add column with oversized Content-Length body returns 413', async () => {
      const res = await fetchJson('/api/databases/dbbigbody/tables/bigtable/columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: oversizedJson({ name: 'extra', type: 'TEXT' })
      });
      assert.strictEqual(res.status, 413);
      assert.strictEqual(res.json.error, 'Request body too large');
    });

    it('create table with chunked oversized body returns 413', async () => {
      const body = oversizedJson({ table: 'hugechunked', columns: { id: 'INTEGER' } });
      const midpoint = Math.floor(body.length / 2);
      const res = await rawRequest(
        'POST',
        '/api/databases/dbbigbody/tables',
        { 'Content-Type': 'application/json' },
        [body.slice(0, midpoint), body.slice(midpoint)]
      );
      assert.strictEqual(res.status, 413);
      assert.strictEqual(res.json.error, 'Request body too large');
    });
  });
});
