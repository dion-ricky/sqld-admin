"use strict";

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  MIN_EXPIRY_SECONDS,
  MAX_EXPIRY_SECONDS,
  TokenSigningUnavailableError,
  buildClaims,
  signJwt,
  loadPrivateKey,
  isSigningAvailable,
  signSqldToken,
} from '../lib/jwt.js';
import * as jwtModule from '../lib/jwt.js';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

let tmpDir;
let privateKeyPath;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqld-jwt-test-'));
  privateKeyPath = path.join(tmpDir, 'private.pem');
  fs.writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function decodeJwt(token) {
  const [headerPart, payloadPart, signaturePart] = token.split('.');
  return {
    header: JSON.parse(Buffer.from(headerPart, 'base64url').toString()),
    payload: JSON.parse(Buffer.from(payloadPart, 'base64url').toString()),
    signingInput: `${headerPart}.${payloadPart}`,
    signature: Buffer.from(signaturePart, 'base64url'),
  };
}

describe('JWT claims', () => {
  it('all databases + write produces only exp', () => {
    const claims = buildClaims({ database: null, access: 'write', expiresInSeconds: 3600, now: 1700000000000 });
    assert.deepStrictEqual(claims, { exp: 1700003600 });
  });

  it('selected database + write uses p.rw.ns', () => {
    const claims = buildClaims({ database: 'dbsimple', access: 'write', expiresInSeconds: 3600, now: 1700000000000 });
    assert.deepStrictEqual(claims, {
      exp: 1700003600,
      p: { rw: { ns: ['dbsimple'] } },
    });
  });

  it('selected database + read uses p.ro.ns', () => {
    const claims = buildClaims({ database: 'dbsimple', access: 'read', expiresInSeconds: 3600, now: 1700000000000 });
    assert.deepStrictEqual(claims, {
      exp: 1700003600,
      p: { ro: { ns: ['dbsimple'] } },
    });
  });

  it('exp is now in seconds plus the requested lifetime', () => {
    const now = 1700000123456;
    const claims = buildClaims({ database: 'db', access: 'write', expiresInSeconds: 86400, now });
    assert.strictEqual(claims.exp, Math.floor(now / 1000) + 86400);
    assert.ok(Number.isInteger(claims.exp));
  });

  it('rejects all-databases read-only', () => {
    assert.throws(
      () => buildClaims({ database: null, access: 'read', expiresInSeconds: 3600 }),
      /Read-only tokens require a database/
    );
  });

  it('rejects an invalid access value', () => {
    assert.throws(
      () => buildClaims({ database: 'db', access: 'admin', expiresInSeconds: 3600 }),
      /access must be 'read' or 'write'/
    );
  });

  it('rejects expiry below the minimum, above the maximum, and non-integers', () => {
    for (const expiresInSeconds of [MIN_EXPIRY_SECONDS - 1, MAX_EXPIRY_SECONDS + 1, 3600.5, '3600']) {
      assert.throws(
        () => buildClaims({ database: 'db', access: 'write', expiresInSeconds }),
        /expiresInSeconds must be an integer/
      );
    }
  });

  it('accepts the expiry bounds', () => {
    assert.ok(buildClaims({ database: 'db', access: 'write', expiresInSeconds: MIN_EXPIRY_SECONDS }).exp);
    assert.ok(buildClaims({ database: 'db', access: 'write', expiresInSeconds: MAX_EXPIRY_SECONDS }).exp);
  });
});

describe('JWT signing', () => {
  it('signs an EdDSA header whose signature verifies with the public key', () => {
    const claims = { exp: 1700003600, p: { rw: { ns: ['dbsimple'] } } };
    const key = loadPrivateKey(privateKeyPath);
    const token = signJwt({ privateKey: key, claims });
    const decoded = decodeJwt(token);

    assert.deepStrictEqual(decoded.header, { alg: 'EdDSA', typ: 'JWT' });
    assert.deepStrictEqual(decoded.payload, claims);
    assert.strictEqual(
      crypto.verify(null, Buffer.from(decoded.signingInput), publicKey, decoded.signature),
      true
    );
  });

  it('signSqldToken builds claims, loads the key, and signs', () => {
    const now = 1700000000000;
    const result = signSqldToken({
      privateKeyPath,
      database: 'dbsimple',
      access: 'read',
      expiresInSeconds: 604800,
      now,
    });

    assert.strictEqual(result.claims.exp, Math.floor(now / 1000) + 604800);
    assert.deepStrictEqual(result.claims.p, { ro: { ns: ['dbsimple'] } });

    const decoded = decodeJwt(result.token);
    assert.deepStrictEqual(decoded.payload, result.claims);
    assert.strictEqual(
      crypto.verify(null, Buffer.from(decoded.signingInput), publicKey, decoded.signature),
      true
    );
  });

  it('reports a missing key as unavailable and refuses to sign', () => {
    const missingPath = path.join(tmpDir, 'missing-private.pem');
    assert.strictEqual(isSigningAvailable(missingPath), false);
    assert.strictEqual(isSigningAvailable(''), false);
    assert.throws(
      () => signSqldToken({ privateKeyPath: missingPath, database: null, access: 'write', expiresInSeconds: 3600 }),
      TokenSigningUnavailableError
    );
  });

  it('reports an invalid key file as unavailable and refuses to sign', () => {
    const invalidPath = path.join(tmpDir, 'invalid-private.pem');
    fs.writeFileSync(invalidPath, 'not a pem', { mode: 0o600 });
    assert.strictEqual(isSigningAvailable(invalidPath), false);
    assert.throws(() => loadPrivateKey(invalidPath), TokenSigningUnavailableError);
    assert.throws(
      () => signSqldToken({ privateKeyPath: invalidPath, database: null, access: 'write', expiresInSeconds: 3600 }),
      TokenSigningUnavailableError
    );
  });

  it('rejects non-Ed25519 keys in the loader, availability check, and signer', () => {
    const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rsaPath = path.join(tmpDir, 'rsa-private.pem');
    fs.writeFileSync(rsaPath, rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });

    assert.strictEqual(isSigningAvailable(rsaPath), false);
    assert.throws(() => loadPrivateKey(rsaPath), TokenSigningUnavailableError);
    assert.throws(
      () => signSqldToken({ privateKeyPath: rsaPath, database: null, access: 'write', expiresInSeconds: 3600 }),
      TokenSigningUnavailableError
    );
    assert.throws(
      () => signJwt({ privateKey: rsa.privateKey, claims: { exp: 1 } }),
      TokenSigningUnavailableError
    );
  });

  it('exports exactly the required API', () => {
    assert.deepStrictEqual(Object.keys(jwtModule).sort(), [
      'MAX_EXPIRY_SECONDS',
      'MIN_EXPIRY_SECONDS',
      'TokenSigningUnavailableError',
      'buildClaims',
      'isSigningAvailable',
      'loadPrivateKey',
      'signJwt',
      'signSqldToken',
    ]);
  });
});
