"use strict";

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const MANAGED_KEYS = [
  'ADMIN_USER',
  'ADMIN_PASSWORD',
  'ALLOW_NO_AUTH',
  'SQLD_AUTH_TOKEN',
  'SQLD_ADMIN_TOKEN',
  'SQLD_JWT_PRIVATE_KEY_FILE',
];

function clearManagedEnv() {
  for (const key of MANAGED_KEYS) {
    delete process.env[key];
  }
}

let importCounter = 0;

// Cache-busting query string forces module-load validation to run again.
async function importConfig() {
  importCounter += 1;
  return import(`../lib/config.js?case=${importCounter}`);
}

describe('Phase 7: config validation', () => {
  it('fails fast when admin credentials are missing', async () => {
    clearManagedEnv();
    await assert.rejects(importConfig(), (error) => {
      assert.match(error.message, /ADMIN_USER/);
      assert.match(error.message, /ADMIN_PASSWORD/);
      return true;
    });
  });

  it('accepts a valid admin user and password', async () => {
    clearManagedEnv();
    process.env.ADMIN_USER = 'admin';
    process.env.ADMIN_PASSWORD = 'secret';

    const { config } = await importConfig();
    assert.strictEqual(config.ADMIN_USER, 'admin');
    assert.strictEqual(config.ADMIN_PASSWORD, 'secret');
    assert.strictEqual(config.ALLOW_NO_AUTH, false);
  });

  it('ALLOW_NO_AUTH=true bypasses the admin credential requirement', async () => {
    clearManagedEnv();
    process.env.ALLOW_NO_AUTH = 'true';

    const { config } = await importConfig();
    assert.strictEqual(config.ALLOW_NO_AUTH, true);
  });

  it('SQLD tokens alone do not satisfy the admin auth requirement', async () => {
    clearManagedEnv();
    process.env.SQLD_AUTH_TOKEN = 'user-token';
    process.env.SQLD_ADMIN_TOKEN = 'admin-token';

    await assert.rejects(importConfig(), /ADMIN_USER/);
  });

  it('SQLD_JWT_PRIVATE_KEY_FILE defaults and can be overridden', async () => {
    clearManagedEnv();
    process.env.ALLOW_NO_AUTH = 'true';

    let imported = await importConfig();
    assert.strictEqual(imported.config.SQLD_JWT_PRIVATE_KEY_FILE, 'secrets/sqld-jwt-private.pem');

    process.env.SQLD_JWT_PRIVATE_KEY_FILE = '/tmp/custom-signing-key.pem';
    imported = await importConfig();
    assert.strictEqual(imported.config.SQLD_JWT_PRIVATE_KEY_FILE, '/tmp/custom-signing-key.pem');
  });
});
