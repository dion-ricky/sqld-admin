"use strict";

// DB_NAME_RE - hostname-safe regex for valid database names
const DB_NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

// RESERVED_DBS - Set of reserved database names
const RESERVED_DBS = new Set(['manager-registry']);

// TABLE_NAME_RE - length-limited regex for valid table names
const TABLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

// COLUMN_TYPES - Set of valid column types
const COLUMN_TYPES = new Set(['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC']);

/**
 * Quote an identifier for safe SQL usage.
 * @param {string} s - identifier to quote
 * @returns {string} quoted identifier
 */
function quoteIdent(s) {
  return '"' + s.replace(/"/g, '""') + '"';
}

/**
 * Validate database name.
 * @param {string} name - database name to validate
 * @throws {Error} if invalid
 */
function validateDbName(name) {
  if (typeof name !== 'string') {
    throw new Error('Database name must be a string');
  }
  
  if (!DB_NAME_RE.test(name)) {
    throw new Error('Invalid database name: ' + name);
  }
  
  if (name.startsWith('sqlite_')) {
    throw new Error('Database name cannot start with sqlite_: ' + name);
  }
  
  if (RESERVED_DBS.has(name)) {
    throw new Error('Database name is reserved: ' + name);
  }
}

/**
 * Validate table name.
 * @param {string} name - table name to validate
 * @throws {Error} if invalid
 */
function validateTableName(name) {
  if (typeof name !== 'string') {
    throw new Error('Table name must be a string');
  }
  
  if (!TABLE_NAME_RE.test(name)) {
    throw new Error('Invalid table name: ' + name);
  }
  
  if (name.startsWith('sqlite_')) {
    throw new Error('Table name cannot start with sqlite_: ' + name);
  }
}

/**
 * Validate column name.
 * @param {string} name - column name to validate
 * @throws {Error} if invalid
 */
function validateColumnName(name) {
  if (typeof name !== 'string') {
    throw new Error('Column name must be a string');
  }
  
  if (!TABLE_NAME_RE.test(name)) {
    throw new Error('Invalid column name: ' + name);
  }
  
  if (name.startsWith('sqlite_')) {
    throw new Error('Column name cannot start with sqlite_: ' + name);
  }
}

/**
 * Build a SQL literal value from a default value.
 * @param {*} defaultValue - default value to build literal from
 * @returns {string} SQL literal
 * @throws {Error} if value cannot be converted to literal
 */
function buildLiteral(defaultValue) {
  if (defaultValue === null || defaultValue === undefined) {
    return 'NULL';
  }
  
  if (typeof defaultValue === 'string') {
    // Handle special keywords including NULL
    const upperValue = defaultValue.toUpperCase();
    if (upperValue === 'NULL' || upperValue === 'CURRENT_TIMESTAMP') {
      return upperValue;
    }
    
    // Escape single quotes by doubling them
    const escaped = defaultValue.replace(/'/g, "''");
    return "'" + escaped + "'";
  }
  
  if (typeof defaultValue === 'number') {
    if (!Number.isFinite(defaultValue)) {
      throw new Error('Invalid number for literal: ' + defaultValue);
    }
    return String(defaultValue);
  }
  
  // For other types (boolean, etc.)
  if (typeof defaultValue === 'boolean') {
    return defaultValue ? '1' : '0';
  }
  
  throw new Error('Unsupported literal value: ' + defaultValue);
}

/**
 * Decode a value from a database cell.
 * @param {*} cell - cell value from database
 * @returns {*} decoded value
 */
function decodeValue(cell) {
  // Handle Hrana cell objects (from sqld wire format). Real sqld uses
  // {type:'null'} for NULL (no value field) and {type:'blob', base64:'...'}
  // for blobs; legacy cells use a value field.
  if (typeof cell === 'object' && cell !== null && 'type' in cell) {
    const { type, value } = cell;
    
    if (type === 'null') {
      return null;
    } else if (type === 'integer') {
      const num = Number(value);
      return Number.isSafeInteger(num) ? num : value;
    } else if (type === 'float') {
      return Number(value);
    } else if (type === 'text') {
      return value;
    } else if (type === 'blob') {
      const encoded = cell.base64 !== undefined ? cell.base64 : value;
      let bytes = 0;
      if (typeof encoded === 'string') {
        bytes = Buffer.from(encoded, 'base64').length;
      } else if (Buffer.isBuffer(encoded)) {
        bytes = encoded.length;
      }
      return { blob: true, bytes };
    } else {
      return cell;
    }
  }
  
  // Handle raw JS values (backward compatibility for existing tests)
  if (cell === null) {
    return null;
  }
  
  if (typeof cell === 'bigint') {
    const num = Number(cell);
    return Number.isSafeInteger(num) ? num : String(cell);
  }
  
  if (typeof cell === 'number') {
    return cell;
  }
  
  if (typeof cell === 'string') {
    return cell;
  }
  
  if (Buffer.isBuffer(cell)) {
    return { blob: true, bytes: cell.length };
  }
  
  if (typeof cell === 'object' && cell !== null) {
    // For other object types, return as-is
    return cell;
  }
  
  // For any other type, convert to string
  return String(cell);
}

export {
  DB_NAME_RE,
  RESERVED_DBS,
  TABLE_NAME_RE,
  COLUMN_TYPES,
  quoteIdent,
  validateDbName,
  validateTableName,
  validateColumnName,
  buildLiteral,
  decodeValue
};