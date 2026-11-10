"use strict";

/**
 * HTTP Basic authentication helper.
 *
 * Credentials are compared with crypto.timingSafeEqual over fixed-length
 * SHA-256 digests so the comparison does not leak input lengths.
 */

import crypto from 'node:crypto';

/**
 * Parse an HTTP Basic Authorization header.
 * @param {string|undefined} header - raw Authorization header value
 * @returns {{user: string, password: string}|null} parsed credentials or null
 */
function parseBasicAuthHeader(header) {
  if (typeof header !== 'string' || header === '') {
    return null;
  }

  const match = header.match(/^Basic\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const payload = match[1].trim();
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload) || payload.length % 4 !== 0) {
    return null;
  }

  const decoded = Buffer.from(payload, 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 0) {
    return null;
  }

  return {
    user: decoded.slice(0, separator),
    password: decoded.slice(separator + 1),
  };
}

function hashValue(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

/**
 * Check an Authorization header against the expected admin credentials.
 * @param {string|undefined} header - raw Authorization header value
 * @param {string|undefined} expectedUser - configured admin username
 * @param {string|undefined} expectedPassword - configured admin password
 * @returns {boolean} true when the header carries valid Basic credentials
 */
function isAuthorizedHeader(header, expectedUser, expectedPassword) {
  if (!expectedUser || !expectedPassword) {
    return false;
  }

  const parsed = parseBasicAuthHeader(header);
  if (!parsed) {
    return false;
  }

  // Evaluate both comparisons so timing does not depend on which one fails.
  const userMatches = crypto.timingSafeEqual(hashValue(parsed.user), hashValue(expectedUser));
  const passwordMatches = crypto.timingSafeEqual(hashValue(parsed.password), hashValue(expectedPassword));

  return userMatches && passwordMatches;
}

export { parseBasicAuthHeader, isAuthorizedHeader };
