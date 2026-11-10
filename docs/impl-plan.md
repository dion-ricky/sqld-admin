# sqld-admin: Implementation Plan

A tiny web GUI to manage databases (namespaces), tables, and view data on a self-hosted **libSQL `sqld`** server running in **namespace mode**.


This document is written for a coding agent. Follow it in order. Do not add scope.


---


## 1. Goals and non-goals


### Goals (MVP)


1. **Manage databases (CRUD):** create, list, rename, duplicate (fork), delete.
2. **Manage tables inside a database (CRUD):** create, list, view schema, rename, add column, drop.
3. **View data in a table** as a paginated grid (read-only).
4. **SQL console**: run ad-hoc SQL against any registered database and view results.


### Non-goals (do not build)


- Row editing, import/export, user accounts, roles, multi-tenant auth.
- Any frontend framework, bundler, TypeScript compile step, or ORM.


---


## 2. Tech stack (fixed)


| Layer | Choice | Reason |
|---|---|---|
| Runtime | **Node.js 22 LTS** | Built-in `http`, `fetch`, `test` runner, `crypto`. |
| Backend | **Plain `node:http`**, ES modules | Zero runtime dependencies. |
| Frontend | **One `index.html` + vanilla JS ES module + one CSS file** | No build step. |
| sqld access | **Hrana over HTTP** (`POST /v2/pipeline`) on the user port | Standard sqld HTTP API. |
| Namespace admin | **sqld admin API** (`/v1/namespaces/...`) on the admin port | Only way to create/delete/fork namespaces. |
| Tests | **`node:test`** | Built in. |
| Packaging | **Docker** (`node:22-alpine`) | Small image. |


**Hard rule: `dependencies` and `devDependencies` in `package.json` must both be empty.**


---


## 3. How sqld works (facts the design depends on)


Verified from the official sqld admin API doc:


- Enable with flags `--enable-namespaces` and `--admin-listen-addr <addr>:<port>`. The admin port must differ from the user port (default 8080).
- Admin API routes:
  - `POST /v1/namespaces/:namespace/create` with body `{ "dump_url"?: string }`
  - `DELETE /v1/namespaces/:namespace`
  - `POST /v1/namespaces/:namespace/fork/:to`
- **There is no documented "list namespaces" endpoint.** The app therefore keeps its own registry (section 5).


To be confirmed in the Phase 0 spike (do not skip it):


- A namespace is selected on the **user port** by the request's **`Host` header** (e.g. `Host: mydb.local` selects namespace `mydb`).
- SQL is executed with `POST /v2/pipeline` using the Hrana-over-HTTP request format (section 6).
- Whether the admin API requires an auth header on this deployment.


---


## 4. Architecture


```
Browser (static SPA)
   |  JSON over HTTP (Basic auth)
   v
sqld-admin (node:http)
   |-- user port  : POST /v2/pipeline   (Host: <ns>.<HOST_SUFFIX>, optional Bearer JWT)
   '-- admin port : POST/DELETE /v1/namespaces/...
   v
sqld (namespace mode)
```


The browser never talks to sqld directly. The JWT and admin URL stay server-side.


### Project layout


```
sqld-admin/
  server.js              # http server, static files, auth, routing
  lib/config.js          # env parsing + validation
  lib/sqld.js            # Hrana client + admin API client
  lib/sql.js             # identifier validation/quoting, value decoding
  lib/registry.js        # database registry (stored in sqld itself)
  lib/routes.js          # API handlers
  public/index.html
  public/app.js
  public/style.css
  test/sql.test.js
  test/routes.test.js    # uses a fake sqld http server
  test/integration.test.js  # runs only if SQLD_TEST_* env is set
  docker-compose.dev.yml # local sqld for development
  Dockerfile
  .env.example
  package.json           # "type": "module", no dependencies
  README.md
```


---


## 5. Database registry (because sqld cannot list namespaces)


- The app owns one reserved namespace: **`manager-registry`** (created automatically on startup if missing).
- It contains one table:


```sql
CREATE TABLE IF NOT EXISTS databases (
  name TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```


- **Create database:** call admin create, then insert into the registry.
- **List databases:** read from the registry.
- **Adopt existing database:** for namespaces created outside this app. Takes a name, verifies it with `SELECT 1` against that namespace, then inserts into the registry.
- **Rename:** fork `old` to `new`, verify, delete `old`, update the registry. Sequence matters: never delete `old` before the fork succeeded. If a step fails, report which step failed and leave data intact.
- **Duplicate:** fork `old` to `new`, insert into the registry.
- **Delete:** admin delete, then remove from the registry.
- `manager-registry` must never appear in the list and must be rejected as a user-supplied name.


---


## 6. sqld client spec (`lib/sqld.js`)


### Transport


Use `node:http` / `node:https` (chosen by URL protocol), **not `fetch`**, because the `Host` header must be set per request and `fetch` implementations may ignore or forbid it.


```js
import http from 'node:http';
import https from 'node:https';


function request({ baseUrl, host, path, method = 'POST', body, token }) {
  const url = new URL(path, baseUrl);
  const lib = url.protocol === 'https:' ? https : http;
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = lib.request(url, {
      method,
      headers: {
        Host: host ?? url.host,
        ...(payload && { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      timeout: 15000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('timeout', () => req.destroy(new Error('sqld request timed out')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
```


### `query(namespace, sql, args = [])`


Request:


```json
POST /v2/pipeline
Host: <namespace>.<HOST_SUFFIX>
{
  "requests": [
    { "type": "execute", "stmt": { "sql": "SELECT ?", "args": [ { "type": "integer", "value": "1" } ] } },
    { "type": "close" }
  ]
}
```


Response shape to handle (verify in Phase 0):


```json
{
  "results": [
    { "type": "ok", "response": { "type": "execute", "result": {
        "cols": [ { "name": "id", "decltype": "INTEGER" } ],
        "rows": [ [ { "type": "integer", "value": "1" } ] ],
        "affected_row_count": 0,
        "last_insert_rowid": null
    } } },
    { "type": "ok", "response": { "type": "close" } }
  ]
}
```


- If `results[0].type === 'error'`, throw `SqldError(message, code)`.
- Argument encoding: `null` -> `{type:"null"}`, integer -> `{type:"integer", value:"<string>"}`, float -> `{type:"float", value:<number>}`, string -> `{type:"text", value}`.
- Value decoding for the UI:
  - `null` -> `null`
  - `integer` -> `Number` if safe, otherwise keep the string
  - `float` -> number
  - `text` -> string
  - `blob` -> `{ blob: true, bytes: <decoded length> }` (never send blob contents to the browser)
- Return `{ columns: string[], rows: any[][], affected: number }`.


### Admin client


- `createNamespace(name)` -> `POST {ADMIN_URL}/v1/namespaces/{name}/create` body `{}`
- `deleteNamespace(name)` -> `DELETE {ADMIN_URL}/v1/namespaces/{name}`
- `forkNamespace(from, to)` -> `POST {ADMIN_URL}/v1/namespaces/{from}/fork/{to}`
- Treat any non-2xx as an error and include the response text in the thrown message.


---


## 7. Safety rules for SQL generation (mandatory)


Identifiers cannot be bound as parameters, so they must be validated **and** quoted.


```js
// lib/sql.js
export const DB_NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;   // hostname-safe
export const RESERVED_DBS = new Set(['manager-registry']);
export const TABLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
export const COLUMN_TYPES = new Set(['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC']);


export const quoteIdent = (s) => `"${String(s).replaceAll('"', '""')}"`;
```


Rules:


1. Every database name, table name, and column name is validated by regex **before** use. Reject names starting with `sqlite_`.
2. Always `quoteIdent()` identifiers in generated SQL, even after validation.
3. Column types come from the allowlist only.
4. Column defaults are built server-side as literals: numbers must pass `Number.isFinite`; text is single-quoted with `'` doubled; also allow the keywords `NULL` and `CURRENT_TIMESTAMP`. Never paste raw user text.
5. Values in `LIMIT`/`OFFSET` are parsed as integers and clamped (`limit` 1..500, default 50; `offset` >= 0), and passed as bound args.
6. Frontend renders all cell and name text with `textContent` (never `innerHTML`). Stored data is untrusted.


---


## 8. HTTP API (JSON)


All responses are JSON. Errors: `{ "error": "message" }` with status 400 (validation), 404, 409 (already exists), 502 (sqld failure).


| Method | Path | Body | Action |
|---|---|---|---|
| GET | `/api/databases` | | List from registry |
| POST | `/api/databases` | `{name}` | Create namespace + register |
| POST | `/api/databases/adopt` | `{name}` | Verify + register existing namespace |
| PATCH | `/api/databases/:db` | `{name}` | Rename (fork, verify, delete old, update registry) |
| POST | `/api/databases/:db/fork` | `{to}` | Duplicate |
| DELETE | `/api/databases/:db` | | Delete namespace + unregister |
| GET | `/api/databases/:db/tables` | | List tables |
| POST | `/api/databases/:db/tables` | `{name, columns:[{name,type,pk,notNull,default}]}` | Create table |
| GET | `/api/databases/:db/tables/:t` | | Schema (columns) |
| PATCH | `/api/databases/:db/tables/:t` | `{name}` | Rename table |
| POST | `/api/databases/:db/tables/:t/columns` | `{name,type,notNull,default}` | Add column |
| DELETE | `/api/databases/:db/tables/:t` | | Drop table |
| GET | `/api/databases/:db/tables/:t/rows?limit=&offset=` | | `{columns, rows, total, limit, offset}` |
| POST | `/api/databases/:db/sql` | `{sql, args?}` | Execute arbitrary SQL, return `{columns, rows, affected}` |


Every `:db` and `:t` path segment must pass validation and (for `:db`) exist in the registry; `:t` must exist in `sqlite_schema`.


**SQL console safety:** The `/api/databases/:db/sql` route passes the user-supplied SQL string directly to sqld. It is **not** parsed or rewritten by the app. Only authenticated users may access it (see Phase 7 auth), and the sqld admin port must remain private (see section 11). Treat the console as a privileged admin tool.


### SQL used


```sql
-- list tables
SELECT name FROM sqlite_schema
WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;


-- schema
PRAGMA table_info("<table>");            -- cid, name, type, notnull, dflt_value, pk


-- create table (generated)
CREATE TABLE "<table>" ("<col>" TYPE [PRIMARY KEY] [NOT NULL] [DEFAULT <literal>], ...);


-- rename table
ALTER TABLE "<old>" RENAME TO "<new>";


-- add column
ALTER TABLE "<table>" ADD COLUMN "<col>" TYPE [NOT NULL] [DEFAULT <literal>];


-- drop table
DROP TABLE "<table>";


-- rows
SELECT * FROM "<table>" LIMIT ? OFFSET ?;
SELECT COUNT(*) FROM "<table>";
```


Note: SQLite rejects `ADD COLUMN ... NOT NULL` without a non-null default. Surface that error message to the UI as-is.


---


## 9. Frontend spec


Single page, hash routing, no libraries.


- `#/` : **Databases** page. Table of databases with actions: Open, Rename, Duplicate, Delete. Buttons: "New database", "Add existing".
- `#/db/<name>` : **Tables** page. List of tables with actions: Open, Rename, Drop. Button: "New table" (dialog with a dynamic column rows form: name, type select, PK, NOT NULL, default).
- `#/db/<name>/table/<t>` : **Table view**. Tabs: **Data** (grid with prev/next pagination, page size 25/50/100, total count) and **Schema** (columns list with "Add column").
- `#/db/<name>/sql` : **SQL console**. Text area for entering SQL, "Run" button, results grid showing columns and rows. Includes a "Limit" input (default 100) and a warning banner that arbitrary SQL is executed as-is.


UX rules:


- Destructive actions (delete database, drop table, rename database) use a confirm dialog. Deleting a database requires typing its name.
- Show server error messages in a visible banner.
- Cells: `null` shown as a dim "NULL"; long text truncated to ~200 chars with the full value in a `title` attribute; blobs shown as `<blob N bytes>`.
- Use `<dialog>` for modals and `fetch` for API calls. Keep CSS under about 150 lines. Support light and dark via `prefers-color-scheme`.


---


## 10. Configuration (`.env.example`)


```
PORT=3000
HOST=0.0.0.0


# sqld user port (SQL) and admin port (namespaces)
SQLD_URL=http://sqld:8080
SQLD_ADMIN_URL=http://sqld:8081


# Suffix appended to the namespace for the Host header: <ns>.<SQLD_HOST_SUFFIX>
SQLD_HOST_SUFFIX=local


# Optional: JWT if sqld auth is enabled; optional admin token if the admin API needs one
SQLD_AUTH_TOKEN=
SQLD_ADMIN_TOKEN=


# App login (HTTP Basic). Required unless ALLOW_NO_AUTH=true (local dev only)
ADMIN_USER=admin
ADMIN_PASSWORD=change-me
ALLOW_NO_AUTH=false
```


`lib/config.js` must fail fast on startup with a clear message if required values are missing or if auth is not configured and `ALLOW_NO_AUTH` is not `true`.


---


## 11. Security requirements


1. HTTP Basic auth on **all** routes (static and API), compared with `crypto.timingSafeEqual`.
2. For `POST`/`PATCH`/`DELETE`: require `Content-Type: application/json` and, when an `Origin` header is present, require it to match the request `Host`. This blocks cross-site request forgery.
3. Request body limit: 1 MB. Reject larger with 413.
4. Never log secrets (JWT, password, Authorization header).
5. Set response headers: `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'self'`, `Cache-Control: no-store` on API responses.
6. Serve static files only from `public/` and prevent path traversal (resolve and check the prefix).
7. Document in the README: put the app behind HTTPS (reverse proxy) and keep the sqld **admin port private**.


---


## 12. Implementation phases


Complete each phase and run its checks before the next.


### Phase 0: Spike (no app code yet)


Start sqld with `docker-compose.dev.yml`, then verify by `curl` and record the findings in `README.md` under "Verified sqld behavior":


1. `POST :8081/v1/namespaces/spike/create` with `{}` returns 2xx.
2. `POST :8080/v2/pipeline` with header `Host: spike.local` executes `CREATE TABLE t(a)` and `SELECT * FROM t`; confirm the response shape in section 6.
3. Confirm a different `Host` (e.g. `other.local`) hits a different, separate namespace.
4. `POST :8081/v1/namespaces/spike/fork/spike2` works and `spike2` contains `t`.
5. `DELETE :8081/v1/namespaces/spike2` works.
6. Check whether the admin API needs an auth header in this deployment.


If any assumption in this plan is wrong, **update this plan first**, then continue.


### Phase 1: Scaffold + sqld client


- `package.json` (`"type":"module"`, scripts: `start`, `test`), `lib/config.js`, `lib/sql.js`, `lib/sqld.js`.
- **Check:** `node --test` passes unit tests for validators, `quoteIdent`, literal builder, and value decoding.


### Phase 2: Registry + database routes


- `lib/registry.js` (auto-create `manager-registry` and its table on startup), database endpoints from section 8, simple router in `server.js` (match by method + path regex).
- **Check:** with `routes.test.js` against a fake sqld, create, list, adopt, rename, fork, and delete behave as specified, including the rename failure ordering.


### Phase 3: Table routes


- Table endpoints and SQL generation per sections 7 and 8.
- **Check:** unit tests for generated `CREATE TABLE` / `ALTER` SQL, including hostile names (`a"; DROP TABLE x;--`) being rejected.


### Phase 4: Rows route


- Pagination, count, value decoding, blob handling.
- **Check:** tests for limit/offset clamping and decoding of null, integer, float, text, and blob.


### Phase 5: SQL console


- Backend route `POST /api/databases/:db/sql` that executes arbitrary SQL via the existing `query()` client and returns `{columns, rows, affected}`.
- Frontend page `#/db/<name>/sql` with a SQL text area, "Run" button, results grid, limit input, and a warning banner.
- **Check:** unit tests for the SQL console route (valid SQL returns rows, invalid SQL returns 502 with sqld error message). Manual check: run `SELECT`, `INSERT`, `CREATE` against a real database.


### Phase 6: Frontend


- Build the four pages from section 9 (databases, tables, table view, SQL console).
- **Check (manual):** the full flow works against real sqld: create db, create table, add column, view empty data, rename table, drop table, duplicate db, rename db, delete db, run a SQL query.


### Phase 7: Auth + hardening


- Basic auth, CSRF checks, body limit, headers, static file safety (section 11). The SQL console route is protected by the same Basic auth as all other routes.
- **Check:** tests for 401 without credentials, 403 on mismatched `Origin`, 413 on oversized body, and path traversal returning 404.


### Phase 8: Packaging + docs


- `Dockerfile`:


```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY lib ./lib
COPY public ./public
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node", "server.js"]
```


- `docker-compose.dev.yml` (local sqld in namespace mode):


```yaml
services:
  sqld:
    image: ghcr.io/tursodatabase/libsql-server:latest
    command: ["sqld", "--enable-namespaces", "--http-listen-addr", "0.0.0.0:8080", "--admin-listen-addr", "0.0.0.0:8081"]
    ports:
      - "8080:8080"
      - "8081:8081"
    volumes:
      - ./.data:/var/lib/sqld
```


- `README.md`: setup, env vars, security notes, "Verified sqld behavior" from Phase 0.


---


## 13. Definition of done


- [x] `package.json` has zero dependencies and zero devDependencies.
- [x] All checks in phases 1 to 5 and 7 pass with `node --test`.
- [x] Manual flow in Phase 6 works against a real sqld in namespace mode.
- [x] No SQL identifier reaches sqld without validation and quoting.
- [x] No use of `innerHTML` with data from sqld or user input.
- [x] App refuses to start without auth configured (unless `ALLOW_NO_AUTH=true`).
- [x] Docker image builds and runs with the env vars in section 10.
- [x] README documents the sqld behaviors confirmed in Phase 0.


## 14. Known limitations (document, do not fix in MVP)


- Databases created outside the app appear only after "Add existing".
- Database rename is implemented as fork + delete, so it temporarily doubles that database's storage and is not atomic.
- Data view is read-only; no row editing.
- Single shared login, no per-user permissions.
