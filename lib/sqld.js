"use strict";

import http from 'node:http';
import https from 'node:https';

import { validateDbName, decodeValue, RESERVED_DBS } from './sql.js';

/**
 * SqldError class for errors from sqld API operations.
 * @param {string} message - Error message
 * @param {number} [code] - Optional error code
 */
class SqldError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SqldError';
    this.code = code;
  }
}

/**
 * Make an HTTP request to sqld server with proper Host header.
 * @param {Object} options - Request options
 * @param {string} options.baseUrl - Base URL (http://sqld:8080 or https://...)
 * @param {string} options.host - Host header value
 * @param {string} options.path - Request path
 * @param {string} [options.method='POST'] - HTTP method
 * @param {Object} [options.body] - Request body (will be JSON stringified)
 * @param {string} [options.token] - Auth token for the Authorization header
 * @param {'bearer'|'basic'} [options.authScheme='bearer'] - Authorization scheme
 * @returns {Promise<{status: number, json: any|null, text: string}>} Response object
 */
function request({ baseUrl, host, path, method = 'POST', body, token, authScheme = 'bearer' }) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const lib = url.protocol === 'https:' ? https : http;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    
    const req = lib.request(url, {
      method,
      headers: {
        Host: host ?? url.host,
        ...(payload && { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }),
        ...(token && {
          Authorization: `${authScheme === 'basic' ? 'Basic' : 'Bearer'} ${token}`
        }),
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

/**
 * Execute SQL query against a sqld namespace.
 * @param {string} namespace - Database namespace
 * @param {string} sql - SQL query to execute
 * @param {Array} [args=[]] - Query arguments
 * @param {Object} config - Server configuration from lib/config.js
 * @returns {Promise<{columns: string[], rows: any[][], affected: number}>} Query result
 * @throws {SqldError} If query returns error
 */
async function query(namespace, sql, args = [], config) {
  // Validate namespace before using it, except for reserved system namespaces
  if (!RESERVED_DBS.has(namespace)) {
    validateDbName(namespace);
  }
  
  const response = await request({
    baseUrl: config.SQLD_URL,
    host: `${namespace}.${config.SQLD_HOST_SUFFIX}`,
    path: '/v2/pipeline',
    method: 'POST',
    body: {
      requests: [
        {
          type: 'execute',
          stmt: {
            sql,
            args: (args || []).map(arg => {
              if (arg === null) {
                return { type: 'null', value: null };
              } else if (typeof arg === 'bigint') {
                return { type: 'integer', value: String(arg) };
              } else if (typeof arg === 'number') {
                return Number.isSafeInteger(arg)
                  ? { type: 'integer', value: String(arg) }
                  : { type: 'float', value: arg };
              } else if (typeof arg === 'string') {
                return { type: 'text', value: arg };
              } else {
                return { type: 'text', value: String(arg) };
              }
            })
          }
        },
        { type: 'close' }
      ]
    },
    token: config.SQLD_AUTH_TOKEN
  });
  
  if (response.status < 200 || response.status >= 300) {
    throw new SqldError(`Request failed with status ${response.status}: ${response.text}`, response.status);
  }
  
  if (!response.json || !response.json.results || response.json.results[0]?.type === 'error') {
    const result = response.json?.results?.[0];
    const errorObj = result?.error;
    const message =
      (typeof errorObj === 'string' ? errorObj : errorObj?.message)
      || (typeof response.json?.error === 'string' ? response.json.error : null)
      || `Query failed: ${response.text}`;
    throw new SqldError(message, errorObj?.code || result?.code || response.status);
  }
  
  const result = response.json.results[0]?.response;
  const columns = result?.result?.cols?.map(col => col.name) || [];
  const rows = (result?.result?.rows || []).map(row => 
    row.map(cell => decodeValue(cell))
  );
  
  return {
    columns,
    rows,
    affected: result?.result?.affected_row_count || 0
  };
}

/**
 * Create a new namespace.
 * @param {string} name - Namespace name
 * @param {Object} config - Server configuration from lib/config.js
 * @returns {Promise} Response from admin API
 * @throws {SqldError} If admin request fails
 */
async function createNamespace(name, config) {
  // Validate name before using it, except for reserved system namespaces
  if (!RESERVED_DBS.has(name)) {
    validateDbName(name);
  }
  
  const response = await request({
    baseUrl: config.SQLD_ADMIN_URL,
    path: `/v1/namespaces/${name}/create`,
    method: 'POST',
    body: {},
    token: config.SQLD_ADMIN_TOKEN,
    authScheme: 'basic'
  });

  if (response.status < 200 || response.status >= 300) {
    throw new SqldError(`Failed to create namespace: ${response.text}`, response.status);
  }
  
  return response.json;
}

/**
 * Delete a namespace.
 * @param {string} name - Namespace name
 * @param {Object} config - Server configuration from lib/config.js
 * @returns {Promise} Response from admin API
 * @throws {SqldError} If admin request fails
 */
async function deleteNamespace(name, config) {
  // Validate name before using it, except for reserved system namespaces
  if (!RESERVED_DBS.has(name)) {
    validateDbName(name);
  }
  
  const response = await request({
    baseUrl: config.SQLD_ADMIN_URL,
    path: `/v1/namespaces/${name}`,
    method: 'DELETE',
    token: config.SQLD_ADMIN_TOKEN,
    authScheme: 'basic'
  });
  
  if (response.status < 200 || response.status >= 300) {
    throw new SqldError(`Failed to delete namespace: ${response.text}`, response.status);
  }
  
  return response.json;
}

/**
 * Fork a namespace.
 * @param {string} from - Source namespace name
 * @param {string} to - Target namespace name
 * @param {Object} config - Server configuration from lib/config.js
 * @returns {Promise} Response from admin API
 * @throws {SqldError} If admin request fails
 */
async function forkNamespace(from, to, config) {
  // Validate from and to before using them, except for reserved system namespaces
  if (!RESERVED_DBS.has(from)) {
    validateDbName(from);
  }
  if (!RESERVED_DBS.has(to)) {
    validateDbName(to);
  }
  
  const response = await request({
    baseUrl: config.SQLD_ADMIN_URL,
    path: `/v1/namespaces/${from}/fork/${to}`,
    method: 'POST',
    body: {},
    token: config.SQLD_ADMIN_TOKEN,
    authScheme: 'basic'
  });

  if (response.status < 200 || response.status >= 300) {
    throw new SqldError(`Failed to fork namespace: ${response.text}`, response.status);
  }
  
  return response.json;
}

export { request, SqldError, query, createNamespace, deleteNamespace, forkNamespace };