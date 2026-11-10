"use strict";

/**
 * Ed25519 sqld JWT generation.
 *
 * This module is pure: it does not read app configuration. Callers pass the
 * private key path so the same signing key used by scripts/generate-sqld-auth.mjs
 * can mint scoped tokens at runtime.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';

const MIN_EXPIRY_SECONDS = 300;
const MAX_EXPIRY_SECONDS = 31536000;

// Typed error so routes can distinguish "signing is not configured" from a
// genuine signing failure without inspecting error messages.
class TokenSigningUnavailableError extends Error {
  constructor(message = 'Token signing is not configured') {
    super(message);
    this.name = 'TokenSigningUnavailableError';
  }
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

/**
 * Build sqld JWT claims for the requested scope.
 * @param {Object} options
 * @param {string|null} [options.database=null] - database namespace, or null for all
 * @param {'read'|'write'} options.access - access level
 * @param {number} options.expiresInSeconds - lifetime in seconds
 * @param {number} [options.now=Date.now()] - current time in milliseconds
 * @returns {Object} claims
 * @throws {Error} on invalid access, expiry, or an all-databases read request
 */
function buildClaims({ database = null, access, expiresInSeconds, now = Date.now() } = {}) {
  if (access !== 'read' && access !== 'write') {
    throw new Error("access must be 'read' or 'write'");
  }

  if (!Number.isInteger(expiresInSeconds)
      || expiresInSeconds < MIN_EXPIRY_SECONDS
      || expiresInSeconds > MAX_EXPIRY_SECONDS) {
    throw new Error(
      `expiresInSeconds must be an integer between ${MIN_EXPIRY_SECONDS} and ${MAX_EXPIRY_SECONDS}`
    );
  }

  const exp = Math.floor(now / 1000) + expiresInSeconds;

  if (database === null) {
    if (access === 'read') {
      throw new Error('Read-only tokens require a database');
    }
    return { exp };
  }

  if (typeof database !== 'string' || database === '') {
    throw new Error('database must be null or a non-empty string');
  }

  if (access === 'write') {
    return { exp, p: { rw: { ns: [database] } } };
  }
  return { exp, p: { ro: { ns: [database] } } };
}

/**
 * Sign a compact JWT with an Ed25519 private key.
 * @param {Object} options
 * @param {crypto.KeyObject} options.privateKey
 * @param {Object} options.claims
 * @returns {string} compact JWT
 */
function signJwt({ privateKey, claims }) {
  if (!privateKey || privateKey.asymmetricKeyType !== 'ed25519') {
    throw new TokenSigningUnavailableError();
  }
  const header = base64url(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' }));
  const payload = base64url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign(null, Buffer.from(signingInput), privateKey);
  return `${signingInput}.${base64url(signature)}`;
}

// Cache loaded keys by resolved path. Key rotation requires a process restart.
const privateKeyCache = new Map();

/**
 * Load and validate an Ed25519 private key from a file.
 * @param {string} filePath
 * @returns {crypto.KeyObject}
 * @throws {TokenSigningUnavailableError} when the path is empty, unreadable,
 *   or does not contain a valid private key
 */
function loadPrivateKey(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new TokenSigningUnavailableError();
  }

  let resolved;
  try {
    resolved = fs.realpathSync(filePath);
  } catch {
    throw new TokenSigningUnavailableError();
  }

  const cached = privateKeyCache.get(resolved);
  if (cached) return cached;

  let pem;
  try {
    pem = fs.readFileSync(resolved);
  } catch {
    throw new TokenSigningUnavailableError();
  }

  let privateKey;
  try {
    privateKey = crypto.createPrivateKey(pem);
  } catch {
    throw new TokenSigningUnavailableError();
  }

  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new TokenSigningUnavailableError();
  }

  privateKeyCache.set(resolved, privateKey);
  return privateKey;
}

/**
 * Report whether a signing key can be loaded. Never returns the path or key.
 * @param {string} filePath
 * @returns {boolean}
 */
function isSigningAvailable(filePath) {
  if (!filePath) return false;
  try {
    loadPrivateKey(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build claims, load the key, and sign a sqld token.
 * @param {Object} options
 * @param {string} options.privateKeyPath
 * @param {string|null} [options.database=null]
 * @param {'read'|'write'} options.access
 * @param {number} options.expiresInSeconds
 * @param {number} [options.now]
 * @returns {{ token: string, claims: Object }}
 */
function signSqldToken({ privateKeyPath, database = null, access, expiresInSeconds, now } = {}) {
  const claims = buildClaims({ database, access, expiresInSeconds, now });
  const privateKey = loadPrivateKey(privateKeyPath);
  return { token: signJwt({ privateKey, claims }), claims };
}

export {
  MIN_EXPIRY_SECONDS,
  MAX_EXPIRY_SECONDS,
  TokenSigningUnavailableError,
  buildClaims,
  signJwt,
  loadPrivateKey,
  isSigningAvailable,
  signSqldToken,
};
