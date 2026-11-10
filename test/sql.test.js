"use strict";

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import * as sqlModule from '../lib/sql.js';

// Constants for testing
const { DB_NAME_RE, RESERVED_DBS, TABLE_NAME_RE, COLUMN_TYPES, 
  quoteIdent, validateDbName, validateTableName, validateColumnName, 
  buildLiteral, decodeValue } = sqlModule;

describe('SQL module - validators and regex', () => {
  describe('DB_NAME_RE', () => {
    it('should match valid database names', () => {
      assert.strictEqual(DB_NAME_RE.test('mydb'), true);
      assert.strictEqual(DB_NAME_RE.test('db123'), true);
      assert.strictEqual(DB_NAME_RE.test('123db'), true); // hostname-safe allows starting with number
      assert.strictEqual(DB_NAME_RE.test('mydb-2'), true);
      assert.strictEqual(DB_NAME_RE.test('db-123'), true);
      assert.strictEqual(DB_NAME_RE.test('my-db'), true);
      assert.strictEqual(DB_NAME_RE.test('db-my'), true);
      assert.strictEqual(DB_NAME_RE.test('a'), true);
    });
    
    it('should not match invalid database names', () => {
      assert.strictEqual(DB_NAME_RE.test(''), false);
      assert.strictEqual(DB_NAME_RE.test('db name'), false);
      assert.strictEqual(DB_NAME_RE.test('_db'), false);
      assert.strictEqual(DB_NAME_RE.test('db_name'), false);
      assert.strictEqual(DB_NAME_RE.test('sqlite_master'), false);
    });
  });
  
  describe('RESERVED_DBS', () => {
    it('should contain manager-registry', () => {
      assert.strictEqual(JSON.stringify([...RESERVED_DBS]), JSON.stringify(['manager-registry']));
    });
  });
  
  describe('TABLE_NAME_RE', () => {
    it('should match valid table names', () => {
      assert.strictEqual(TABLE_NAME_RE.test('myTable'), true);
      assert.strictEqual(TABLE_NAME_RE.test('table123'), true);
      assert.strictEqual(TABLE_NAME_RE.test('table_name'), true);
      assert.strictEqual(TABLE_NAME_RE.test('_table'), true);
      assert.strictEqual(TABLE_NAME_RE.test('table'), true);
    });
    
    it('should not match invalid table names', () => {
      assert.strictEqual(TABLE_NAME_RE.test('123table'), false);
      assert.strictEqual(TABLE_NAME_RE.test('table-name'), false);
      assert.strictEqual(TABLE_NAME_RE.test(''), false);
      assert.strictEqual(TABLE_NAME_RE.test('table name'), false);
    });
  });
  
  describe('COLUMN_TYPES', () => {
    it('should contain all expected column types', () => {
      assert.strictEqual(JSON.stringify([...COLUMN_TYPES]), JSON.stringify([
        'INTEGER',
        'TEXT',
        'REAL',
        'BLOB',
        'NUMERIC'
      ]));
    });
  });
});

describe('SQL module - quoteIdent', () => {
  it('should quote single identifier', () => {
    assert.strictEqual(quoteIdent('table'), '"table"');
  });
  
  it('should quote and escape double quotes', () => {
    assert.strictEqual(quoteIdent('table"name'), '"table""name"');
  });
  
  it('should quote empty string', () => {
    assert.strictEqual(quoteIdent(''), '""');
  });
});

describe('SQL module - validateDbName', () => {
  it('should accept valid database names', () => {
    validateDbName('mydb');
    validateDbName('db123');
    validateDbName('mydb-2');
    validateDbName('db-123');
    validateDbName('my-db');
    validateDbName('db-my');
  });
  
  it('should reject database names starting with sqlite_', () => {
    let error;
    try {
      validateDbName('sqlite_master');
    } catch (e) {
      error = e;
    }
    assert.strictEqual(error.message, 'Invalid database name: sqlite_master');
  });
  
  it('should reject reserved database names', () => {
    let error;
    try {
      validateDbName('manager-registry');
    } catch (e) {
      error = e;
    }
    assert.strictEqual(error.message, 'Database name is reserved: manager-registry');
  });
  
  it('should throw for non-string input', () => {
    let error;
    try {
      validateDbName(123);
    } catch (e) {
      error = e;
    }
    assert.strictEqual(error.message, 'Database name must be a string');
    
    error = null;
    try {
      validateDbName(null);
    } catch (e) {
      error = e;
    }
    assert.strictEqual(error.message, 'Database name must be a string');
  });
});

describe('SQL module - validateTableName', () => {
  it('should accept valid table names', () => {
    validateTableName('mytable');
    validateTableName('table123');
    validateTableName('_table');
    validateTableName('table_name');
  });
  
  it('should reject table names starting with sqlite_', () => {
    let error;
    try {
      validateTableName('sqlite_master');
    } catch (e) {
      error = e;
    }
    assert.strictEqual(error.message, 'Table name cannot start with sqlite_: sqlite_master');
  });
  
  it('should throw for non-string input', () => {
    let error;
    try {
      validateTableName(123);
    } catch (e) {
      error = e;
    }
    assert.strictEqual(error.message, 'Table name must be a string');
  });
});

describe('SQL module - validateColumnName', () => {
  it('should accept valid column names', () => {
    validateColumnName('column');
    validateColumnName('col123');
    validateColumnName('_column');
    validateColumnName('column_name');
  });
  
  it('should reject column names starting with sqlite_', () => {
    let error;
    try {
      validateColumnName('sqlite_col');
    } catch (e) {
      error = e;
    }
    assert.strictEqual(error.message, 'Column name cannot start with sqlite_: sqlite_col');
  });
  
  it('should throw for non-string input', () => {
    let error;
    try {
      validateColumnName(123);
    } catch (e) {
      error = e;
    }
    assert.strictEqual(error.message, 'Column name must be a string');
  });
});

describe('SQL module - buildLiteral', () => {
  it('should build NULL literal', () => {
    assert.strictEqual(buildLiteral(null), 'NULL');
    assert.strictEqual(buildLiteral(undefined), 'NULL');
  });
  
  it('should build number literals', () => {
    assert.strictEqual(buildLiteral(42), '42');
    assert.strictEqual(buildLiteral(3.14), '3.14');
    assert.strictEqual(buildLiteral(-5), '-5');
  });
  
  it('should build string literals with single quotes', () => {
    assert.strictEqual(buildLiteral('hello'), "'hello'");
    assert.strictEqual(buildLiteral("it's nice"), "'it''s nice'");
  });
  
  it('should build NULL keyword (new spec)', () => {
    assert.strictEqual(buildLiteral('NULL'), 'NULL');
  });
  
  it('should build CURRENT_TIMESTAMP keyword', () => {
    assert.strictEqual(buildLiteral('CURRENT_TIMESTAMP'), 'CURRENT_TIMESTAMP');
    assert.strictEqual(buildLiteral('current_timestamp'), 'CURRENT_TIMESTAMP');
  });
  
  it('should reject non-finite numbers', () => {
    let error;
    try {
      buildLiteral(NaN);
    } catch (e) {
      error = e;
    }
    assert.strictEqual(error.message, 'Invalid number for literal: ' + NaN);
    
    error = null;
    try {
      buildLiteral(Infinity);
    } catch (e) {
      error = e;
    }
    assert.strictEqual(error.message, 'Invalid number for literal: ' + Infinity);
    
    error = null;
    try {
      buildLiteral(-Infinity);
    } catch (e) {
      error = e;
    }
    assert.strictEqual(error.message, 'Invalid number for literal: ' + (-Infinity));
  });
  
  it('should reject unsupported literal types', () => {
    let error;
    try {
      buildLiteral({});
    } catch (e) {
      error = e;
    }
    assert.strictEqual(error.message, 'Unsupported literal value: [object Object]');
    
    error = null;
    try {
      buildLiteral([]);
    } catch (e) {
      error = e;
    }
    assert.strictEqual(error.message, 'Unsupported literal value: ');
  });
});

describe('SQL module - decodeValue', () => {
  it('should decode null values', () => {
    assert.strictEqual(decodeValue(null), null);
  });
  
  it('should decode integer values', () => {
    assert.strictEqual(decodeValue(42), 42);
    assert.strictEqual(decodeValue(0), 0);
    assert.strictEqual(decodeValue(-5), -5);
  });
  
  it('should decode bigint values as numbers when safe', () => {
    assert.strictEqual(decodeValue(BigInt(42)), 42);
    assert.strictEqual(decodeValue(BigInt(9007199254740991)), 9007199254740991);
  });
  
  it('should decode bigint values as strings when unsafe', () => {
    assert.strictEqual(decodeValue(BigInt(9007199254740992)), '9007199254740992');
  });
  
  it('should decode float values', () => {
    assert.strictEqual(decodeValue(3.14), 3.14);
    assert.strictEqual(decodeValue(-2.5), -2.5);
  });
  
  it('should decode string values', () => {
    assert.strictEqual(decodeValue('hello'), 'hello');
    assert.strictEqual(decodeValue(''), '');
  });
  
  it('should decode Buffer values as blob objects', () => {
    const buffer = Buffer.from('test');
    assert.strictEqual(decodeValue(buffer).blob, true);
    assert.strictEqual(decodeValue(buffer).bytes, 4);
  });
  
  it('should convert other types to string', () => {
    assert.strictEqual(decodeValue(true), 'true');
    assert.strictEqual(decodeValue(false), 'false');
  });
});

describe('SQL module - decodeValue Hrana cells', () => {
  it('should decode Hrana null cell', () => {
    assert.strictEqual(decodeValue({ type: 'null' }), null);
    assert.strictEqual(decodeValue({ type: 'null', value: null }), null);
  });

  it('should decode Hrana integer cell as number when safe', () => {
    assert.strictEqual(decodeValue({ type: 'integer', value: '42' }), 42);
    assert.strictEqual(decodeValue({ type: 'integer', value: '0' }), 0);
    assert.strictEqual(decodeValue({ type: 'integer', value: '-5' }), -5);
  });

  it('should decode Hrana integer cell as string when unsafe', () => {
    assert.strictEqual(
      decodeValue({ type: 'integer', value: '9007199254740992' }),
      '9007199254740992'
    );
  });

  it('should decode Hrana float cell', () => {
    assert.strictEqual(decodeValue({ type: 'float', value: '3.14' }), 3.14);
    assert.strictEqual(decodeValue({ type: 'float', value: '-2.5' }), -2.5);
  });

  it('should decode Hrana text cell', () => {
    assert.strictEqual(decodeValue({ type: 'text', value: 'hello' }), 'hello');
    assert.strictEqual(decodeValue({ type: 'text', value: '' }), '');
  });

  it('should decode Hrana blob cell', () => {
    const real = decodeValue({ type: 'blob', base64: 'aGVsbG8=' });
    assert.deepStrictEqual(real, { blob: true, bytes: 5 });
    assert.strictEqual(real.base64, undefined);
    assert.strictEqual(real.value, undefined);

    const unpadded = decodeValue({ type: 'blob', base64: 'aGVsbG8' });
    assert.deepStrictEqual(unpadded, { blob: true, bytes: 5 });

    const legacy = decodeValue({ type: 'blob', value: 'aGVsbG8=' });
    assert.deepStrictEqual(legacy, { blob: true, bytes: 5 });
    assert.strictEqual(legacy.base64, undefined);
    assert.strictEqual(legacy.value, undefined);
  });

  it('should return unknown cell types as-is', () => {
    const cell = { type: 'unknown', value: 'x' };
    assert.strictEqual(decodeValue(cell), cell);
    const bareCell = { type: 'unknown' };
    assert.strictEqual(decodeValue(bareCell), bareCell);
  });
});