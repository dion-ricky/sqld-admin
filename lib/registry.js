"use strict";

import { validateDbName, RESERVED_DBS } from './sql.js';
import { query, createNamespace, deleteNamespace, forkNamespace, SqldError } from './sqld.js';

/**
 * Initialize the database registry.
 * @param {Object} config - Server configuration from lib/config.js
 * @returns {Promise} Always resolves, idempotent for existing manager-registry
 */
async function initRegistry(config) {
  try {
    await createNamespace('manager-registry', config);
  } catch (error) {
    if (error instanceof SqldError && error.code === 404) {
      // Namespace doesn't exist - we will attempt to create the databases table below, which will also fail
    } else {
      // For other errors (like already exists), we treat as OK - idempotency
      // No warning for the idempotent already-exists case
    }
  }
  
  try {
    await query('manager-registry', 'CREATE TABLE IF NOT EXISTS databases (name TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)', [], config);
  } catch (error) {
    console.error('Failed to ensure databases table exists:', error.message);
    throw error;
  }
}

/**
 * List all registered databases.
 * @param {Object} config - Server configuration from lib/config.js
 * @returns {Promise<string[]>} Array of database names (excluding manager-registry)
 */
async function listDatabases(config) {
  try {
    const result = await query('manager-registry', 'SELECT name FROM databases ORDER BY name', [], config);
    return result.rows.map(row => row[0]).filter(name => name !== 'manager-registry');
  } catch (error) {
    console.error('Failed to list databases:', error.message);
    throw error;
  }
}

/**
 * Register a database in the registry.
 * @param {Object} config - Server configuration from lib/config.js
 * @param {string} name - Database name to register
 */
async function registerDatabase(config, name) {
  validateDbName(name);
  
  try {
    await query('manager-registry', 'INSERT INTO databases (name) VALUES (?)', [name], config);
  } catch (error) {
    console.error('Failed to register database:', error.message);
    throw error;
  }
}

/**
 * Unregister a database from the registry.
 * @param {Object} config - Server configuration from lib/config.js
 * @param {string} name - Database name to unregister
 */
async function unregisterDatabase(config, name) {
  try {
    await query('manager-registry', 'DELETE FROM databases WHERE name = ?', [name], config);
  } catch (error) {
    console.error('Failed to unregister database:', error.message);
    throw error;
  }
}

/**
 * Check if a database name is reserved.
 * @param {string} name - Database name to check
 * @returns {boolean} True if name is reserved, false otherwise
 */
function databaseNameIsReserved(name) {
  return RESERVED_DBS.has(name);
}

export { initRegistry, listDatabases, registerDatabase, unregisterDatabase };