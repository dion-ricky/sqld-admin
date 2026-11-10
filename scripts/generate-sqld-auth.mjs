#!/usr/bin/env node
"use strict";

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildClaims,
  signJwt,
  MIN_EXPIRY_SECONDS,
  MAX_EXPIRY_SECONDS,
} from '../lib/jwt.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const secretsDir = path.join(root, 'secrets');
const publicKeyPath = path.join(secretsDir, 'sqld-jwt-public.pem');
const privateKeyPath = path.join(secretsDir, 'sqld-jwt-private.pem');
const envPath = path.join(root, '.env');

const force = process.argv.includes('--force');
const daysArg = process.argv.find((arg) => arg.startsWith('--days='));
const days = daysArg ? Number(daysArg.slice('--days='.length)) : 365;

if (!Number.isFinite(days) || days <= 0) {
  console.error('Invalid --days value; expected a positive number.');
  process.exit(1);
}

const expiresInSeconds = Math.floor(days * 86400);
if (expiresInSeconds < MIN_EXPIRY_SECONDS || expiresInSeconds > MAX_EXPIRY_SECONDS) {
  console.error(
    `Invalid --days value; expected a lifetime between ${MIN_EXPIRY_SECONDS} seconds and ${MAX_EXPIRY_SECONDS / 86400} days.`
  );
  process.exit(1);
}

if (!fs.existsSync(envPath)) {
  console.error('Missing .env. Copy .env.example to .env first.');
  process.exit(1);
}

if (!force && (fs.existsSync(publicKeyPath) || fs.existsSync(privateKeyPath))) {
  console.error('sqld auth secrets already exist. Re-run with --force to rotate them.');
  process.exit(1);
}

fs.mkdirSync(secretsDir, { recursive: true });

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644 });
fs.writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });

const claims = buildClaims({ database: null, access: 'write', expiresInSeconds });
const token = signJwt({ privateKey, claims });
const expiresAt = claims.exp;
const adminToken = crypto.randomBytes(32).toString('base64url');

function upsertEnv(content, key, value) {
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(content)) return content.replace(pattern, `${key}=${value}`);
  return `${content.replace(/\s*$/, '')}\n${key}=${value}\n`;
}

let env = fs.readFileSync(envPath, 'utf8');
env = upsertEnv(env, 'SQLD_AUTH_TOKEN', token);
env = upsertEnv(env, 'SQLD_ADMIN_TOKEN', adminToken);
env = upsertEnv(env, 'SQLD_JWT_PRIVATE_KEY_FILE', './secrets/sqld-jwt-private.pem');
const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
const gid = typeof process.getgid === 'function' ? process.getgid() : 1000;
env = upsertEnv(env, 'APP_UID', String(uid));
env = upsertEnv(env, 'APP_GID', String(gid));
fs.writeFileSync(envPath, env);

console.log('Created sqld auth material:');
console.log(`  ${path.relative(root, publicKeyPath)} (mount into sqld)`);
console.log(`  ${path.relative(root, privateKeyPath)} (keep private; used to mint new JWTs)`);
console.log('');
console.log('Updated .env:');
console.log(`  SQLD_AUTH_TOKEN (JWT, expires ${new Date(expiresAt * 1000).toISOString()})`);
console.log('  SQLD_ADMIN_TOKEN');
console.log('  SQLD_JWT_PRIVATE_KEY_FILE');
console.log(`  APP_UID=${uid} APP_GID=${gid}`);
console.log('');
console.log(`The app container runs as ${uid}:${gid} so it can read the 0600 private key.`);
console.log('Restart the stack with: docker compose up -d --build');
