"use strict";

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './lib/config.js';
import { isAuthorizedHeader } from './lib/auth.js';
import { validateDbName, RESERVED_DBS, validateTableName, validateColumnName, COLUMN_TYPES, buildLiteral, quoteIdent } from './lib/sql.js';
import { initRegistry, listDatabases, registerDatabase, unregisterDatabase } from './lib/registry.js';
import { query, createNamespace, deleteNamespace, forkNamespace, SqldError } from './lib/sqld.js';
import { signSqldToken, isSigningAvailable, MIN_EXPIRY_SECONDS, MAX_EXPIRY_SECONDS } from './lib/jwt.js';

// Helper function to validate a database name and respond with 400 if invalid
function validateNameOr400(res, name) {
  try {
    validateDbName(name);
    return true;
  } catch (error) {
    if (error instanceof Error) {
      sendJsonResponse(res, 400, { error: error.message });
    } else {
      sendJsonResponse(res, 400, { error: 'Invalid database name' });
    }
    return false;
  }
}

/**
 * Validate database and respond with 404 if not registered or 400 for reserved.
 */
async function validateDbOr400(res, db) {
  // Validate name format first
  if (!validateNameOr400(res, db)) {
    return false;
  }
  
  // Check if database exists in registry
  const registered = await listDatabases(config);
  if (!registered.includes(db)) {
    sendJsonResponse(res, 404, { error: 'Database not found' });
    return false;
  }
  
  // Check if it's a reserved name (should have been caught by validateDbName but double-check)
  if (RESERVED_DBS.has(db)) {
    sendJsonResponse(res, 400, { error: 'Database name is reserved' });
    return false;
  }
  
  return true;
}

/**
 * Validate table name and check table exists, respond with 404 if not.
 */
async function validateTableOr404(res, db, t) {
  // Validate table name first
  if (!validateTableNameOr400(res, t)) {
    return false;
  }
  
  // Check if table exists by querying sqlite_schema
  try {
    const result = await query(
      db,
      "SELECT name FROM sqlite_schema WHERE type='table' AND name = ?",
      [t],
      config
    );
    if (result.rows.length === 0) {
      sendJsonResponse(res, 404, { error: 'Table not found' });
      return false;
    }
    return true;
  } catch (error) {
    console.error('Failed to validate table existence:', error);
    sendJsonResponse(res, 502, { error: 'Failed to validate table' });
    return false;
  }
}

/**
 * Validate table name and respond with 400 if invalid.
 */
function validateTableNameOr400(res, t) {
  try {
    validateTableName(t);
    return true;
  } catch (error) {
    if (error instanceof Error) {
      sendJsonResponse(res, 400, { error: error.message });
    } else {
      sendJsonResponse(res, 400, { error: 'Invalid table name' });
    }
    return false;
  }
}

// Define custom error for oversized body
class BodyTooLargeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BodyTooLargeError';
  }
}

const MAX_BODY_BYTES = 1024 * 1024;

// Token generation options and rate limiting.
const TOKEN_EXPIRY_OPTIONS = [
  { label: '1 hour', seconds: 3600 },
  { label: '1 day', seconds: 86400 },
  { label: '7 days', seconds: 604800 },
  { label: '30 days', seconds: 2592000 },
  { label: '90 days', seconds: 7776000 },
  { label: '1 year', seconds: 31536000 },
];
const DEFAULT_TOKEN_EXPIRY_SECONDS = 2592000;
const TOKEN_RATE_LIMIT_WINDOW_MS = 60000;
const TOKEN_RATE_LIMIT_MAX_REQUESTS = 10;

// In-memory per-client limiter for POST /api/auth/tokens.
const tokenRateLimits = new Map();

function checkTokenRateLimit(req) {
  const key = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = tokenRateLimits.get(key);

  if (!entry || now - entry.windowStart >= TOKEN_RATE_LIMIT_WINDOW_MS) {
    tokenRateLimits.set(key, { windowStart: now, count: 1 });
    return { allowed: true };
  }

  if (entry.count >= TOKEN_RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((entry.windowStart + TOKEN_RATE_LIMIT_WINDOW_MS - now) / 1000)),
    };
  }

  entry.count += 1;
  return { allowed: true };
}



/**
 * SQL Generation Functions
 */

/**
 * Generate SQL for listing tables in a database.
 * @param {string} db - database name
 * @returns {string} SQL query
 */
function genListTablesSQL(db) {
  validateDbName(db);
  return "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name";
}

/**
 * Generate SQL for getting table schema.
 * @param {string} table - table name
 * @returns {string} SQL query
 */
function genSchemaSQL(table) {
  validateTableName(table);
  return 'PRAGMA table_info(' + quoteIdent(table) + ')';
}

/**
 * Generate SQL for creating a table.
 * @param {string} table - table name
 * @param {Array} columns - array of column definitions {name, type, primaryKey, notNull, defaultValue}
 * @returns {string} SQL query
 */
function genCreateTableSQL(table, columns) {
  validateTableName(table);
  
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error('At least one column is required');
  }
  
  const columnDefs = [];
  for (const col of columns) {
    validateColumnName(col.name);
    if (!COLUMN_TYPES.has(col.type)) {
      throw new Error("Invalid column type: " + col.type);
    }
    
    let def = quoteIdent(col.name) + ' ' + col.type;
    if (col.primaryKey) {
      def += ' PRIMARY KEY';
    }
    if (col.notNull) {
      def += ' NOT NULL';
    }
    if (col.defaultValue !== undefined) {
      def += ' DEFAULT ' + buildLiteral(col.defaultValue);
    }
    columnDefs.push(def);
  }
  
  return 'CREATE TABLE ' + quoteIdent(table) + ' (' + columnDefs.join(', ') + ')';
}

/**
 * Generate SQL for renaming a table.
 * @param {string} oldTable - old table name
 * @param {string} newTable - new table name
 * @returns {string} SQL query
 */
function genRenameTableSQL(oldTable, newTable) {
  validateTableName(oldTable);
  validateTableName(newTable);
  return 'ALTER TABLE ' + quoteIdent(oldTable) + ' RENAME TO ' + quoteIdent(newTable);
}

/**
 * Generate SQL for adding a column to a table.
 * @param {string} table - table name
 * @param {Object} column - column definition {name, type, notNull, defaultValue}
 * @returns {string} SQL query
 */
function genAddColumnSQL(table, column) {
  validateTableName(table);
  validateColumnName(column.name);
  if (!COLUMN_TYPES.has(column.type)) {
    throw new Error("Invalid column type: " + column.type);
  }
  
  let def = quoteIdent(column.name) + ' ' + column.type;
  if (column.notNull) {
    def += ' NOT NULL';
  }
  if (column.defaultValue !== undefined) {
    def += ' DEFAULT ' + buildLiteral(column.defaultValue);
  }
  
  return 'ALTER TABLE ' + quoteIdent(table) + ' ADD COLUMN ' + def;
}

/**
 * Generate SQL for dropping a table.
 * @param {string} table - table name
 * @returns {string} SQL query
 */
function genDropTableSQL(table) {
  validateTableName(table);
  return 'DROP TABLE ' + quoteIdent(table);
}

/**
 * Generate SQL for fetching paginated rows from a table.
 * @param {string} table - table name
 * @param {number} limit - max number of rows to return (already clamped)
 * @param {number} offset - number of rows to skip (already clamped)
 * @returns {string} SQL query with bound-arg placeholders
 */
function genRowsSQL(table, limit, offset) {
  validateTableName(table);
  return 'SELECT * FROM ' + quoteIdent(table) + ' LIMIT ? OFFSET ?';
}

/**
 * Generate SQL for counting all rows in a table.
 * @param {string} table - table name
 * @returns {string} SQL query
 */
function genCountSQL(table) {
  validateTableName(table);
  return 'SELECT COUNT(*) FROM ' + quoteIdent(table);
}

// Initialize server
// CSRF / Content-Type middleware for POST/PATCH/DELETE
function validateRequestHeaders(req, res) {
  if (['POST', 'PATCH', 'DELETE'].includes(req.method)) {
    // When an Origin header is present, require it to match the request Host
    const origin = req.headers.origin;
    if (origin) {
      let originHost;
      try {
        originHost = new URL(origin).host;
      } catch (error) {
        sendJsonResponse(res, 403, { error: 'Origin header mismatch' });
        return false;
      }
      if (originHost !== req.headers.host) {
        sendJsonResponse(res, 403, { error: 'Origin header mismatch' });
        return false;
      }
    }

    // Require a JSON media type (parameters such as ; charset=utf-8 are allowed)
    const contentType = req.headers['content-type'] || '';
    const mediaType = contentType.split(';')[0].trim().toLowerCase();

    if (mediaType !== 'application/json') {
      sendJsonResponse(res, 400, { error: 'Content-Type must be application/json' });
      return false;
    }
  }
  return true;
}

// Security headers helper — applied to all JSON API responses and static files
function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('Cache-Control', 'no-store');
}

// Unauthorized response helper — advertises Basic auth and returns JSON 401
function sendUnauthorized(res) {
  res.setHeader('WWW-Authenticate', 'Basic realm="sqld-admin", charset="UTF-8"');
  sendJsonResponse(res, 401, { error: 'Unauthorized' });
}

// Static file serving handler
function handleStaticFile(req, res, pathname) {
  // Path traversal prevention: only serve targets strictly inside public/
  const publicDir = path.resolve(process.cwd(), 'public');
  const resolvedPath = path.resolve(publicDir, pathname);
  const relativePath = path.relative(publicDir, resolvedPath);

  if (!relativePath || relativePath === '..' || relativePath.startsWith('..' + path.sep) || path.isAbsolute(relativePath)) {
    sendJsonResponse(res, 404, { error: 'not found' });
    return;
  }
  
  // Read file
  fs.readFile(resolvedPath, (err, data) => {
    if (err) {
      sendJsonResponse(res, 404, { error: 'not found' });
      return;
    }
    
    // Set Content-Type based on extension
    const ext = path.extname(resolvedPath).toLowerCase();
    let contentType = 'text/plain';
    switch (ext) {
      case '.html': contentType = 'text/html'; break;
      case '.js': contentType = 'application/javascript'; break;
      case '.css': contentType = 'text/css'; break;
      case '.json': contentType = 'application/json'; break;
      case '.woff2': contentType = 'font/woff2'; break;
      case '.txt': contentType = 'text/plain'; break;
      case '.png': contentType = 'image/png'; break;
      case '.jpg':
      case '.jpeg': contentType = 'image/jpeg'; break;
      case '.gif': contentType = 'image/gif'; break;
      case '.svg': contentType = 'image/svg+xml'; break;
    }
    
    // Set security headers
    setSecurityHeaders(res);

    // Pinned font asset; cache it long-term.
    if (ext === '.woff2') {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }

    // Send response
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    // Enforce Basic auth on all routes (static and API) before anything else
    if (!config.ALLOW_NO_AUTH
        && !isAuthorizedHeader(req.headers.authorization, config.ADMIN_USER, config.ADMIN_PASSWORD)) {
      sendUnauthorized(res);
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }
    
    // Validate request headers for POST/PATCH/DELETE
    if (!validateRequestHeaders(req, res)) {
      return;
    }
    
    // Parse URL
    const parsedUrl = new URL(req.url, 'http://' + req.headers.host);
    const pathname = parsedUrl.pathname;
    
    // Static file serving
    const isFontAsset = pathname === '/fonts/OFL.txt'
      || /^\/fonts\/[A-Za-z0-9._-]+\.woff2$/.test(pathname);
    if (req.method === 'GET' && (pathname === '/' || pathname === '/app.js' || pathname === '/style.css' || isFontAsset)) {
      const relativePath = pathname === '/' ? 'index.html' : pathname.substring(1); // Remove leading slash
      handleStaticFile(req, res, relativePath);
      return;
    }
    
    // Route: GET /api/databases
    if (req.method === 'GET' && pathname === '/api/databases') {
      await handleListDatabases(res);
      return;
    }
    
    // Route: POST /api/databases
    if (req.method === 'POST' && pathname === '/api/databases') {
      await handleCreateDatabase(req, res);
      return;
    }
    
    // Route: POST /api/databases/adopt
    if (req.method === 'POST' && pathname === '/api/databases/adopt') {
      await handleAdoptDatabase(req, res);
      return;
    }
    
    // Route: PATCH /api/databases/:db
    if (req.method === 'PATCH' && pathname.match(/^\/api\/databases\/([^\/]+)$/)) {
      const match = pathname.match(/^\/api\/databases\/([^\/]+)$/);
      const db = match[1];
      await handleRenameDatabase(req, res, db);
      return;
    }
    
    // Route: POST /api/databases/:db/fork
    if (req.method === 'POST' && pathname.match(/^\/api\/databases\/([^\/]+)\/fork$/)) {
      const match = pathname.match(/^\/api\/databases\/([^\/]+)\/fork$/);
      const db = match[1];
      await handleForkDatabase(req, res, db);
      return;
    }
    
    // Route: DELETE /api/databases/:db
    if (req.method === 'DELETE' && pathname.match(/^\/api\/databases\/([^\/]+)$/)) {
      const match = pathname.match(/^\/api\/databases\/([^\/]+)$/);
      const db = match[1];
      await handleDeleteDatabase(res, db);
      return;
    }
    
    // Route: GET /api/databases/:db/tables - list tables
    if (req.method === 'GET' && pathname.match(/^\/api\/databases\/([^\/]+)\/tables$/)) {
      const match = pathname.match(/^\/api\/databases\/([^\/]+)\/tables$/);
      const db = match[1];
      await handleListTables(res, db);
      return;
    }
    
    // Route: POST /api/databases/:db/tables - create table
    if (req.method === 'POST' && pathname.match(/^\/api\/databases\/([^\/]+)\/tables$/)) {
      const match = pathname.match(/^\/api\/databases\/([^\/]+)\/tables$/);
      const db = match[1];
      await handleCreateTable(req, res, db);
      return;
    }
    
    // Route: GET /api/databases/:db/tables/:t - get table schema
    if (req.method === 'GET' && pathname.match(/^\/api\/databases\/([^\/]+)\/tables\/([^\/]+)$/)) {
      const match = pathname.match(/^\/api\/databases\/([^\/]+)\/tables\/([^\/]+)$/);
      const db = match[1];
      const t = match[2];
      await handleGetTableSchema(res, db, t);
      return;
    }
    
    // Route: PATCH /api/databases/:db/tables/:t - rename table
    if (req.method === 'PATCH' && pathname.match(/^\/api\/databases\/([^\/]+)\/tables\/([^\/]+)$/)) {
      const match = pathname.match(/^\/api\/databases\/([^\/]+)\/tables\/([^\/]+)$/);
      const db = match[1];
      const t = match[2];
      await handleRenameTable(req, res, db, t);
      return;
    }
    
    // Route: POST /api/databases/:db/tables/:t/columns - add column
    if (req.method === 'POST' && pathname.match(/^\/api\/databases\/([^\/]+)\/tables\/([^\/]+)\/columns$/)) {
      const match = pathname.match(/^\/api\/databases\/([^\/]+)\/tables\/([^\/]+)\/columns$/);
      const db = match[1];
      const t = match[2];
      await handleAddColumn(req, res, db, t);
      return;
    }
    
    // Route: DELETE /api/databases/:db/tables/:t - drop table
    if (req.method === 'DELETE' && pathname.match(/^\/api\/databases\/([^\/]+)\/tables\/([^\/]+)$/)) {
      const match = pathname.match(/^\/api\/databases\/([^\/]+)\/tables\/([^\/]+)$/);
      const db = match[1];
      const t = match[2];
      await handleDropTable(res, db, t);
      return;
    }

    // Route: GET /api/databases/:db/tables/:t/rows - paginated rows
    if (req.method === 'GET' && pathname.match(/^\/api\/databases\/([^\/]+)\/tables\/([^\/]+)\/rows$/)) {
      const match = pathname.match(/^\/api\/databases\/([^\/]+)\/tables\/([^\/]+)\/rows$/);
      const db = match[1];
      const t = match[2];
      await handleGetTableRows(req, res, db, t);
      return;
    }
    
    // Route: POST /api/databases/:db/sql - SQL console (arbitrary user SQL)
    if (req.method === 'POST' && pathname.match(/^\/api\/databases\/([^\/]+)\/sql$/)) {
      const match = pathname.match(/^\/api\/databases\/([^\/]+)\/sql$/);
      const db = match[1];
      await handleSqlConsole(req, res, db);
      return;
    }
    
    // Route: GET /api/auth/config - token-generation capabilities
    if (req.method === 'GET' && pathname === '/api/auth/config') {
      handleAuthConfig(res);
      return;
    }

    // Route: POST /api/auth/tokens - mint a scoped sqld JWT
    if (req.method === 'POST' && pathname === '/api/auth/tokens') {
      await handleGenerateToken(req, res);
      return;
    }

    // Unknown route
    sendJsonResponse(res, 404, { error: 'not found' });
  } catch (error) {
    console.error('Unhandled error:', error);
    if (error instanceof BodyTooLargeError) {
      sendJsonResponse(res, 413, { error: 'Request body too large' });
    } else {
      sendJsonResponse(res, 502, { error: 'Internal server error' });
    }
  }
});

/**
 * Handle GET /api/databases - list all registered databases
 */
async function handleListDatabases(res) {
  try {
    const databases = await listDatabases(config);
    sendJsonResponse(res, 200, databases);
  } catch (error) {
    console.error('Failed to list databases:', error);
    sendJsonResponse(res, 502, { error: 'Failed to list databases' });
  }
}

/**
 * Handle GET /api/auth/config - report token-generation capabilities.
 */
function handleAuthConfig(res) {
  sendJsonResponse(res, 200, {
    signingEnabled: isSigningAvailable(config.SQLD_JWT_PRIVATE_KEY_FILE),
    appAuthDisabled: config.ALLOW_NO_AUTH,
    defaultExpirySeconds: DEFAULT_TOKEN_EXPIRY_SECONDS,
    minExpirySeconds: MIN_EXPIRY_SECONDS,
    maxExpirySeconds: MAX_EXPIRY_SECONDS,
    expiryOptions: TOKEN_EXPIRY_OPTIONS,
    scopes: {
      allDatabasesWrite: true,
      databaseWrite: true,
      databaseRead: true,
    },
  });
}

/**
 * Handle POST /api/auth/tokens - validate the request and sign a sqld JWT.
 * Tokens and request bodies are never logged.
 */
async function handleGenerateToken(req, res) {
  const limit = checkTokenRateLimit(req);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfter));
    sendJsonResponse(res, 429, { error: 'Too many token generation requests; try again shortly.' });
    return;
  }

  try {
    const body = await parseJsonBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      sendJsonResponse(res, 400, { error: 'Request body must be a JSON object' });
      return;
    }

    const { database, access, expiresInSeconds } = body;

    if (database !== null && (typeof database !== 'string' || database === '')) {
      sendJsonResponse(res, 400, { error: 'database must be null or a non-empty string' });
      return;
    }

    if (access !== 'read' && access !== 'write') {
      sendJsonResponse(res, 400, { error: "access must be 'read' or 'write'" });
      return;
    }

    if (!Number.isInteger(expiresInSeconds)
        || expiresInSeconds < MIN_EXPIRY_SECONDS
        || expiresInSeconds > MAX_EXPIRY_SECONDS) {
      sendJsonResponse(res, 400, {
        error: `expiresInSeconds must be an integer between ${MIN_EXPIRY_SECONDS} and ${MAX_EXPIRY_SECONDS}`,
      });
      return;
    }

    if (database === null && access === 'read') {
      sendJsonResponse(res, 400, { error: 'Read-only tokens require a database' });
      return;
    }

    if (typeof database === 'string') {
      if (!validateNameOr400(res, database)) {
        return;
      }
      const databases = await listDatabases(config);
      if (!databases.includes(database)) {
        sendJsonResponse(res, 404, { error: 'Database not found' });
        return;
      }
    }

    if (!isSigningAvailable(config.SQLD_JWT_PRIVATE_KEY_FILE)) {
      sendJsonResponse(res, 503, { error: 'Token signing is not configured' });
      return;
    }

    let result;
    try {
      result = signSqldToken({
        privateKeyPath: config.SQLD_JWT_PRIVATE_KEY_FILE,
        database,
        access,
        expiresInSeconds,
      });
    } catch {
      // Never include the key path or request details in logs or responses.
      console.error('Failed to sign sqld token');
      sendJsonResponse(res, 502, { error: 'Failed to generate token' });
      return;
    }

    sendJsonResponse(res, 200, {
      token: result.token,
      expiresAt: new Date(result.claims.exp * 1000).toISOString(),
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      sendJsonResponse(res, 400, { error: 'Invalid JSON' });
    } else if (error instanceof BodyTooLargeError) {
      sendJsonResponse(res, 413, { error: 'Request body too large' });
    } else {
      console.error('Token generation error:', error);
      sendJsonResponse(res, 502, { error: 'Failed to generate token' });
    }
  }
}

/**
 * Handle POST /api/databases - create and register a new database
 */
async function handleCreateDatabase(req, res) {
  try {
    // Parse body
    const body = await parseJsonBody(req);
    if (!body || typeof body.name !== 'string') {
      sendJsonResponse(res, 400, { error: 'Request body must contain name field' });
      return;
    }
    
    const name = body.name;
    
    // Validate name
    if (!validateNameOr400(res, name)) {
      return;
    }
    
    // Check if already registered
    const registered = await listDatabases(config);
    if (registered.includes(name)) {
      sendJsonResponse(res, 409, { error: 'Database already registered' });
      return;
    }
    
    // Create namespace and register
    try {
      await createNamespace(name, config);
      await registerDatabase(config, name);
      sendJsonResponse(res, 200, { name });
    } catch (error) {
      if (error instanceof SqldError && error.code === 409) {
        // Namespace already exists but not registered; require the adopt flow
        sendJsonResponse(res, 409, {
          error: 'Namespace already exists; use Add existing to adopt it'
        });
      } else {
        sendJsonResponse(res, 502, { error: 'Failed to create namespace' });
      }
    }
  } catch (error) {
    console.error('Create database error:', error);
    if (error instanceof SyntaxError) {
      sendJsonResponse(res, 400, { error: 'Invalid JSON' });
    } else if (error instanceof BodyTooLargeError) {
      sendJsonResponse(res, 413, { error: 'Request body too large' });
    } else {
      sendJsonResponse(res, 502, { error: 'Failed to create database' });
    }
  }
}

/**
 * Handle POST /api/databases/adopt - adopt existing namespace
 */
async function handleAdoptDatabase(req, res) {
  try {
    // Parse body
    const body = await parseJsonBody(req);
    if (!body || typeof body.name !== 'string') {
      sendJsonResponse(res, 400, { error: 'Request body must contain name field' });
      return;
    }
    
    const name = body.name;
    
    // Validate name
    if (!validateNameOr400(res, name)) {
      return;
    }
    
    // Check if already registered
    const registered = await listDatabases(config);
    if (registered.includes(name)) {
      sendJsonResponse(res, 409, { error: 'Database already registered' });
      return;
    }
    
    // Verify namespace exists
    try {
      await query(name, 'SELECT 1', [], config);
    } catch (error) {
      if (error instanceof SqldError && error.code === 404) {
        sendJsonResponse(res, 404, { error: 'Namespace does not exist' });
        return;
      }
      sendJsonResponse(res, 502, { error: 'Failed to verify namespace' });
      return;
    }
    
    // Register
    await registerDatabase(config, name);
    sendJsonResponse(res, 200, { name });
  } catch (error) {
    console.error('Adopt database error:', error);
    if (error instanceof SyntaxError) {
      sendJsonResponse(res, 400, { error: 'Invalid JSON' });
    } else if (error instanceof BodyTooLargeError) {
      sendJsonResponse(res, 413, { error: 'Request body too large' });
    } else {
      sendJsonResponse(res, 502, { error: 'Failed to adopt database' });
    }
  }
}

/**
 * Handle PATCH /api/databases/:db - rename database
 */
async function handleRenameDatabase(req, res, db) {
  try {
    // Validate existing database name
    if (!validateNameOr400(res, db)) {
      return;
    }
    
    // Check if exists in registry
    const registered = await listDatabases(config);
    if (!registered.includes(db)) {
      sendJsonResponse(res, 404, { error: 'Database not found' });
      return;
    }
    
    // Parse body
    const body = await parseJsonBody(req);
    if (!body || typeof body.name !== 'string') {
      sendJsonResponse(res, 400, { error: 'Request body must contain name field' });
      return;
    }
    
    const newName = body.name;
    
    // Validate new name
    if (!validateNameOr400(res, newName)) {
      return;
    }
    
    // Check if new name is already registered
    const registeredNew = await listDatabases(config);
    if (registeredNew.includes(newName)) {
      sendJsonResponse(res, 409, { error: 'New database name already registered' });
      return;
    }
    
    // Rename sequence: fork -> verify -> delete old -> update registry
    try {
      // Step 1: Fork
      await forkNamespace(db, newName, config);
    } catch (error) {
      sendJsonResponse(res, 502, { error: 'Failed to fork namespace' });
      return;
    }
    
    try {
      // Step 2: Verify new namespace
      await query(newName, 'SELECT 1', [], config);
    } catch (error) {
      // Fork succeeded but verification failed, clean up
      try {
        await deleteNamespace(newName, config);
      } catch (cleanupError) {
        console.error('Failed to clean up forked namespace:', cleanupError);
      }
      sendJsonResponse(res, 502, { error: 'Failed to verify forked namespace' });
      return;
    }
    
    try {
      // Step 3: Delete old namespace
      await deleteNamespace(db, config);
    } catch (error) {
      // This is a failure after fork succeeded, but we can't rollback fork
      console.error('Failed to delete old namespace:', error);
      sendJsonResponse(res, 502, { error: 'Failed to delete old namespace' });
      return;
    }
    
    try {
      // Step 4: Update registry
      await unregisterDatabase(config, db);
      await registerDatabase(config, newName);
      sendJsonResponse(res, 200, { old: db, new: newName });
    } catch (error) {
      // If registry update fails, we can't rollback the namespace operations
      // This is a partial failure scenario
      console.error('Failed to update registry:', error);
      sendJsonResponse(res, 502, { error: 'Failed to update registry' });
    }
  } catch (error) {
    console.error('Rename database error:', error);
    if (error instanceof SyntaxError) {
      sendJsonResponse(res, 400, { error: 'Invalid JSON' });
    } else if (error instanceof BodyTooLargeError) {
      sendJsonResponse(res, 413, { error: 'Request body too large' });
    } else {
      sendJsonResponse(res, 502, { error: 'Failed to rename database' });
    }
  }
}

/**
 * Handle POST /api/databases/:db/fork - fork duplicate database
 */
async function handleForkDatabase(req, res, db) {
  try {
    // Validate database name
    if (!validateNameOr400(res, db)) {
      return;
    }
    
    // Check if exists in registry
    const registered = await listDatabases(config);
    if (!registered.includes(db)) {
      sendJsonResponse(res, 404, { error: 'Database not found' });
      return;
    }
    
    // Parse body
    const body = await parseJsonBody(req);
    if (!body || typeof body.to !== 'string') {
      sendJsonResponse(res, 400, { error: 'Request body must contain to field' });
      return;
    }
    
    const to = body.to;
    
    // Validate target name
    if (!validateNameOr400(res, to)) {
      return;
    }
    
    // Check if target already registered
    const registeredTo = await listDatabases(config);
    if (registeredTo.includes(to)) {
      sendJsonResponse(res, 409, { error: 'Target database already registered' });
      return;
    }
    
    // Fork namespace and register
    await forkNamespace(db, to, config);
    await registerDatabase(config, to);
    sendJsonResponse(res, 200, { from: db, to });
  } catch (error) {
    console.error('Fork database error:', error);
    if (error instanceof SyntaxError) {
      sendJsonResponse(res, 400, { error: 'Invalid JSON' });
    } else if (error instanceof BodyTooLargeError) {
      sendJsonResponse(res, 413, { error: 'Request body too large' });
    } else {
      sendJsonResponse(res, 502, { error: 'Failed to fork database' });
    }
  }
}

/**
 * Handle DELETE /api/databases/:db - delete database
 */
async function handleDeleteDatabase(res, db) {
  try {
    // Validate database name
    if (!validateNameOr400(res, db)) {
      return;
    }
    
    // Check if exists in registry
    const registered = await listDatabases(config);
    if (!registered.includes(db)) {
      sendJsonResponse(res, 404, { error: 'Database not found' });
      return;
    }
    
    // Delete namespace and unregister
    await deleteNamespace(db, config);
    await unregisterDatabase(config, db);
    sendJsonResponse(res, 200, { name: db });
  } catch (error) {
    console.error('Delete database error:', error);
    if (error instanceof SyntaxError) {
      sendJsonResponse(res, 400, { error: 'Invalid JSON' });
    } else if (error instanceof BodyTooLargeError) {
      sendJsonResponse(res, 413, { error: 'Request body too large' });
    } else {
      sendJsonResponse(res, 502, { error: 'Failed to delete database' });
    }
  }
}

/**
 * Handle GET /api/databases/:db/tables - list tables
 */
async function handleListTables(res, db) {
  try {
    // Validate database first
    if (!await validateDbOr400(res, db)) {
      return;
    }
    
    const sql = genListTablesSQL(db);
    const result = await query(db, sql, [], config);
    
    sendJsonResponse(res, 200, result.rows.map(row => row[0]));
  } catch (error) {
    console.error('List tables error:', error);
    if (error instanceof SqldError) {
      if (error.code === 404) {
        sendJsonResponse(res, 404, { error: 'Database not found' });
        return;
      }
      sendJsonResponse(res, 502, { error: 'Failed to list tables' });
    } else {
      sendJsonResponse(res, 502, { error: 'Failed to list tables' });
    }
  }
}

/**
 * Handle POST /api/databases/:db/tables - create table
 */
async function handleCreateTable(req, res, db) {
  try {
    // Validate database first
    if (!await validateDbOr400(res, db)) {
      return;
    }
    
    // Parse body
    const body = await parseJsonBody(req);
    if (!body || typeof body.table !== 'string' || typeof body.columns !== 'object') {
      sendJsonResponse(res, 400, { error: 'Request body must contain table (string) and columns (object) fields' });
      return;
    }
    
    const table = body.table;
    const columns = body.columns;
    
    // Validate table name
    if (!validateTableNameOr400(res, table)) {
      return;
    }
    
    // Validate columns
    if (columns == null || 
        (Array.isArray(columns) && columns.length === 0) ||
        (!Array.isArray(columns) && Object.keys(columns).length === 0)) {
      sendJsonResponse(res, 400, { error: 'At least one column is required' });
      return;
    }
    
    // Convert columns object to array format expected by genCreateTableSQL
    const columnArray = Object.entries(columns).map(([name, typeSpec]) => {
      if (typeof typeSpec !== 'string') {
        throw new Error("Invalid column type for column '" + name + "'");
      }
      // Parse type spec like "INTEGER PRIMARY KEY" or "TEXT NOT NULL"
      const parts = typeSpec.trim().split(/\s+/);
      const baseType = parts[0];
      if (!COLUMN_TYPES.has(baseType)) {
        throw new Error("Invalid column type: " + baseType);
      }
      return {
        name,
        type: baseType,
        primaryKey: parts.includes('PRIMARY') || parts.includes('PRIMARY_KEY'),
        notNull: parts.includes('NOT') || parts.includes('NOT_NULL'),
        defaultValue: undefined
      };
    });
    
    const sql = genCreateTableSQL(table, columnArray);
    await query(db, sql, [], config);
    
    sendJsonResponse(res, 200, { table });
  } catch (error) {
    console.error('Create table error:', error);
    if (error instanceof BodyTooLargeError) {
      sendJsonResponse(res, 413, { error: 'Request body too large' });
      return;
    }
    if (error instanceof SqldError) {
      sendJsonResponse(res, 502, { error: error.message });
    } else {
      // Check for validation errors
      if (error.message.includes('Invalid table name') || 
          error.message.includes('Invalid column name') || 
          error.message.includes('Invalid column type')) {
        sendJsonResponse(res, 400, { error: error.message });
      } else {
        sendJsonResponse(res, 502, { error: 'Failed to create table' });
      }
    }
  }
}

/**
 * Handle GET /api/databases/:db/tables/:t - get table schema
 */
async function handleGetTableSchema(res, db, t) {
  try {
    // Validate database first
    if (!await validateDbOr400(res, db)) {
      return;
    }
    
    // Validate table and check it exists
    if (!await validateTableOr404(res, db, t)) {
      return;
    }
    
    const sql = genSchemaSQL(t);
    const result = await query(db, sql, [], config);
    
    // Transform PRAGMA table_info result to column info
    const columns = result.rows.map(row => ({
      cid: row[0],
      name: row[1],
      type: row[2],
      notnull: Boolean(row[3]),
      dflt_value: row[4],
      pk: Boolean(row[5])
    }));
    
    sendJsonResponse(res, 200, { columns });
  } catch (error) {
    console.error('Get table schema error:', error);
    if (error instanceof SqldError) {
      if (error.code === 404) {
        sendJsonResponse(res, 404, { error: 'Database not found' });
        return;
      }
      sendJsonResponse(res, 502, { error: 'Failed to get table schema' });
    } else {
      sendJsonResponse(res, 502, { error: 'Failed to get table schema' });
    }
  }
}

/**
 * Handle PATCH /api/databases/:db/tables/:t - rename table
 */
async function handleRenameTable(req, res, db, t) {
  try {
    // Validate database first
    if (!await validateDbOr400(res, db)) {
      return;
    }
    
    // Validate existing table and check it exists
    if (!await validateTableOr404(res, db, t)) {
      return;
    }
    
    // Parse body
    const body = await parseJsonBody(req);
    if (!body || typeof body.name !== 'string') {
      sendJsonResponse(res, 400, { error: 'Request body must contain name field' });
      return;
    }
    
    const newTable = body.name;
    
    // Validate new table name
    if (!validateTableNameOr400(res, newTable)) {
      return;
    }
    
    const sql = genRenameTableSQL(t, newTable);
    await query(db, sql, [], config);
    
    sendJsonResponse(res, 200, { old: t, new: newTable });
  } catch (error) {
    console.error('Rename table error:', error);
    if (error instanceof BodyTooLargeError) {
      sendJsonResponse(res, 413, { error: 'Request body too large' });
      return;
    }
    if (error instanceof SqldError) {
      sendJsonResponse(res, 502, { error: error.message });
    } else {
      if (error.message.includes('Invalid table name')) {
        sendJsonResponse(res, 400, { error: error.message });
      } else {
        sendJsonResponse(res, 502, { error: 'Failed to rename table' });
      }
    }
  }
}

/**
 * Handle POST /api/databases/:db/tables/:t/columns - add column
 */
async function handleAddColumn(req, res, db, t) {
  try {
    // Validate database first
    if (!await validateDbOr400(res, db)) {
      return;
    }
    
    // Validate existing table and check it exists
    if (!await validateTableOr404(res, db, t)) {
      return;
    }
    
    // Parse body
    const body = await parseJsonBody(req);
    if (!body || typeof body.name !== 'string' || typeof body.type !== 'string') {
      sendJsonResponse(res, 400, { error: 'Request body must contain name and type fields' });
      return;
    }
    
    const column = {
      name: body.name,
      type: body.type,
      notNull: body.notNull || false,
      defaultValue: body.defaultValue
    };
    
    const sql = genAddColumnSQL(t, column);
    await query(db, sql, [], config);
    
    sendJsonResponse(res, 200, { column });
  } catch (error) {
    console.error('Add column error:', error);
    if (error instanceof BodyTooLargeError) {
      sendJsonResponse(res, 413, { error: 'Request body too large' });
      return;
    }
    if (error instanceof SqldError) {
      sendJsonResponse(res, 502, { error: error.message });
    } else {
      if (error.message.includes('Invalid column name') || 
          error.message.includes('Invalid column type')) {
        sendJsonResponse(res, 400, { error: error.message });
      } else {
        sendJsonResponse(res, 502, { error: 'Failed to add column' });
      }
    }
  }
}

/**
 * Handle DELETE /api/databases/:db/tables/:t - drop table
 */
async function handleDropTable(res, db, t) {
  try {
    // Validate database first
    if (!await validateDbOr400(res, db)) {
      return;
    }
    
    // Validate existing table and check it exists
    if (!await validateTableOr404(res, db, t)) {
      return;
    }
    
    const sql = genDropTableSQL(t);
    await query(db, sql, [], config);
    
    sendJsonResponse(res, 200, { table: t });
  } catch (error) {
    console.error('Drop table error:', error);
    if (error instanceof SqldError) {
      if (error.code === 404) {
        sendJsonResponse(res, 404, { error: 'Table not found' });
        return;
      }
      sendJsonResponse(res, 502, { error: 'Failed to drop table' });
    } else {
      sendJsonResponse(res, 502, { error: 'Failed to drop table' });
    }
  }
}



/**
 * Handle GET /api/databases/:db/tables/:t/rows - paginated rows
 */
async function handleGetTableRows(req, res, db, t) {
  try {
    // Validate database first
    if (!await validateDbOr400(res, db)) {
      return;
    }
    
    // Validate table and check it exists
    if (!await validateTableOr404(res, db, t)) {
      return;
    }
    
    // Parse and clamp limit/offset from query params
    const url = new URL(req.url, 'http://' + req.headers.host);
    const limitParam = url.searchParams.get('limit');
    const offsetParam = url.searchParams.get('offset');
    
    let limit = limitParam ? parseInt(limitParam, 10) : 50;
    let offset = offsetParam ? parseInt(offsetParam, 10) : 0;
    
    // Clamp limit to 1..500 (default 50)
    if (!Number.isFinite(limit) || limit < 1) limit = 50;
    else if (limit > 500) limit = 500;

    // Clamp offset to >= 0 (default 0). Non-numeric/malformed values
    // (e.g. ?offset=abc) must not be passed through to sqld as-is.
    if (!Number.isFinite(offset) || offset < 0) offset = 0;
    
    // Generate and execute queries
    const rowsSql = genRowsSQL(t, limit, offset);
    const countSql = genCountSQL(t);
    
    const rowsResult = await query(db, rowsSql, [limit, offset], config);
    const countResult = await query(db, countSql, [], config);
    
    const total = countResult.rows.length > 0 ? countResult.rows[0][0] : 0;
    
    sendJsonResponse(res, 200, {
      columns: rowsResult.columns,
      rows: rowsResult.rows,
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Get table rows error:', error);
    if (error instanceof SqldError) {
      if (error.code === 404) {
        sendJsonResponse(res, 404, { error: 'Table not found' });
        return;
      }
      sendJsonResponse(res, 502, { error: 'Failed to get table rows' });
    } else {
      sendJsonResponse(res, 502, { error: 'Failed to get table rows' });
    }
  }
}

/**
 * Handle POST /api/databases/:db/sql - execute arbitrary user-supplied SQL
 */
async function handleSqlConsole(req, res, db) {
  try {
    // Validate database first
    if (!await validateDbOr400(res, db)) {
      return;
    }
    
    // Parse body
    const body = await parseJsonBody(req);
    if (!body || typeof body.sql !== 'string') {
      sendJsonResponse(res, 400, { error: 'Request body must contain sql field' });
      return;
    }
    
    const sql = body.sql;
    const args = body.args || [];
    
    // Execute SQL via sqld client
    try {
      const result = await query(db, sql, args, config);
      
      // Return successful response
      sendJsonResponse(res, 200, {
        columns: result.columns,
        rows: result.rows,
        affected: result.affected || 0
      });
    } catch (error) {
      if (error instanceof SqldError) {
        // Map sqld errors to 502 with the sqld error message
        sendJsonResponse(res, 502, { error: error.message });
      } else {
        // Unexpected error
        sendJsonResponse(res, 502, { error: 'Failed to execute SQL' });
      }
    }
  } catch (error) {
    console.error('SQL console error:', error);
    if (error instanceof SyntaxError) {
      sendJsonResponse(res, 400, { error: 'Invalid JSON' });
    } else if (error instanceof BodyTooLargeError) {
      sendJsonResponse(res, 413, { error: 'Request body too large' });
    } else {
      sendJsonResponse(res, 502, { error: 'Failed to execute SQL' });
    }
  }
}

/**
 * Parse JSON body with 1MB limit
 */
async function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const contentLength = req.headers['content-length'];
    const declaredLength = contentLength === undefined ? NaN : Number(contentLength);

    // Reject early when the declared length is valid and already too large
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      req.resume();
      reject(new BodyTooLargeError('Request body too large'));
      return;
    }

    let body = '';
    let bodyLength = 0;
    let failed = false;

    req.on('data', (chunk) => {
      if (failed) {
        return;
      }
      bodyLength += chunk.length;
      if (bodyLength > MAX_BODY_BYTES) {
        failed = true;
        body = '';
        req.resume();
        reject(new BodyTooLargeError('Request body too large'));
        return;
      }
      body += chunk.toString();
    });

    req.on('end', () => {
      if (failed) {
        return;
      }
      try {
        if (body.trim() === '') {
          resolve(null);
        } else {
          resolve(JSON.parse(body));
        }
      } catch (error) {
        reject(new SyntaxError('Invalid JSON'));
      }
    });

    req.on('error', reject);
  });
}

/**
 * Send JSON response with security headers
 */
function sendJsonResponse(res, statusCode, body) {
  setSecurityHeaders(res);
  
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Startup
async function startup() {
  await initRegistry(config);
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      reject(error);
    };
    server.once('error', onError);
    server.listen(config.PORT, config.HOST, () => {
      server.removeListener('error', onError);
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : config.PORT;
      console.log("Server started on " + config.HOST + ":" + port);
      resolve();
    });
  });
}

// Start server only when run directly
if (import.meta.main) {
  startup();
}

export { server, startup };

export {
  validateDbName,
  validateTableName,
  validateColumnName,
  COLUMN_TYPES,
  buildLiteral,
  genListTablesSQL,
  genSchemaSQL,
  genCreateTableSQL,
  genRenameTableSQL,
  genAddColumnSQL,
  genDropTableSQL,
  genRowsSQL,
  genCountSQL,
  handleSqlConsole
};

// Handle server shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close();
  process.exit(0);
});