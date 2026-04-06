#!/usr/bin/env node

/**
 * Comprehensive Database Health Check — YapBay API
 *
 * Parses schema.sql at runtime and compares every object (tables, columns,
 * indexes, functions, triggers) against the live database.
 * Fully dynamic — adapts automatically when schema.sql changes.
 *
 * Usage:
 *   node scripts/db/db-health-check.js              # default
 *   node scripts/db/db-health-check.js --verbose     # extra detail
 */

const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');

// Load environment
if (fs.existsSync('.env.local')) {
  require('dotenv').config({ path: '.env.local' });
}
require('dotenv').config();

const verbose = process.argv.includes('--verbose');
const URL_MASK_REGEX = /:[^:@]+@/;

const databaseUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('❌ Missing POSTGRES_URL or DATABASE_URL environment variable');
  process.exit(1);
}

// ─── Schema.sql parser ──────────────────────────────────────────────────────

const SQL_LINE_COMMENT_REGEX = /--[^\n]*/g;
const CREATE_TABLE_REGEX = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\n\);/gi;
const COLUMN_DEF_REGEX =
  /^(\w+)\s+(VARCHAR\s*\(\s*\d+\s*\)|TEXT\s*\[\s*\]|TEXT|SERIAL|BIGINT|INTEGER|INT\b|SMALLINT|BOOLEAN|BOOL\b|DECIMAL\s*\([^)]+\)|NUMERIC\s*(?:\([^)]+\))?|UUID|TIMESTAMP\s+WITH\s+TIME\s+ZONE|TIMESTAMPTZ|TIMESTAMP|DATE\b|TIME\b|JSONB|JSON\b|INET|CIDR|CHAR\b|REAL|FLOAT|DOUBLE\s+PRECISION|BYTEA|INTERVAL)/i;
const NOT_NULL_REGEX = /\bNOT\s+NULL\b/i;
const PRIMARY_KEY_REGEX = /\bPRIMARY\s+KEY\b/i;
const CONSTRAINT_PREFIX_REGEX = /^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY)\b/i;
const INDEX_REGEX =
  /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\s+(\w+)(?:\s+USING\s+(\w+))?\s*\(([^)]+(?:\([^)]*\))?[^)]*)\)(?:\s+WHERE\s+(.+?))?;/gi;
const FUNCTION_REGEX =
  /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(\w+)\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)\s*\nRETURNS\s+([\w\s(),]+?)\s+AS\s+\$\$/gi;
const TRIGGER_REGEX =
  /CREATE\s+TRIGGER\s+(\w+)\s+(BEFORE|AFTER)\s+((?:INSERT|UPDATE|DELETE)(?:\s+OR\s+(?:INSERT|UPDATE|DELETE))*)\s+ON\s+(\w+)\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+(\w+)\s*\(\s*\)/gi;

// Type mapping
const SIMPLE_TYPE_MAP = {
  TEXT: { dataType: 'text' },
  INTEGER: { dataType: 'integer' },
  INT: { dataType: 'integer' },
  SERIAL: { dataType: 'integer' },
  BIGINT: { dataType: 'bigint' },
  SMALLINT: { dataType: 'smallint' },
  BOOLEAN: { dataType: 'boolean' },
  BOOL: { dataType: 'boolean' },
  NUMERIC: { dataType: 'numeric' },
  UUID: { dataType: 'uuid' },
  'TIMESTAMP WITH TIME ZONE': { dataType: 'timestamp with time zone' },
  TIMESTAMPTZ: { dataType: 'timestamp with time zone' },
  TIMESTAMP: { dataType: 'timestamp without time zone' },
  DATE: { dataType: 'date' },
  JSONB: { dataType: 'jsonb' },
  JSON: { dataType: 'json' },
  INET: { dataType: 'inet' },
};

function splitTableBody(body) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of body) {
    if (char === '(' || char === '[') {
      depth++;
    } else if (char === ')' || char === ']') {
      depth--;
    }
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) {
    parts.push(current);
  }
  return parts;
}

function parseColumnDetails(line) {
  const m = line.match(COLUMN_DEF_REGEX);
  if (!m) {
    return null;
  }
  const name = m[1].toLowerCase();
  const rawType = m[2].toUpperCase().replace(/\s+/g, ' ').trim();
  const afterType = line.slice(m[0].length).trim();
  const notNull = NOT_NULL_REGEX.test(afterType) || PRIMARY_KEY_REGEX.test(line);
  return { name, type: rawType, notNull };
}

function parseTableBody(_tableName, rawBody) {
  const body = rawBody.replace(SQL_LINE_COMMENT_REGEX, '');
  const columns = {};
  const parts = splitTableBody(body);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    if (CONSTRAINT_PREFIX_REGEX.test(trimmed)) {
      continue;
    }
    const col = parseColumnDetails(trimmed);
    if (col) {
      columns[col.name] = { type: col.type, notNull: col.notNull };
    }
  }

  return { columns };
}

function parseSchema(sql) {
  const tables = {};
  const indexes = {};
  const functions = {};
  const triggers = {};

  // Tables
  CREATE_TABLE_REGEX.lastIndex = 0;
  let m = CREATE_TABLE_REGEX.exec(sql);
  while (m !== null) {
    const tableName = m[1].toLowerCase();
    tables[tableName] = parseTableBody(tableName, m[2]);
    m = CREATE_TABLE_REGEX.exec(sql);
  }

  // Indexes
  INDEX_REGEX.lastIndex = 0;
  m = INDEX_REGEX.exec(sql);
  while (m !== null) {
    const unique = !!m[1];
    const indexName = m[2].toLowerCase();
    const table = m[3].toLowerCase();
    indexes[indexName] = { table, unique };
    m = INDEX_REGEX.exec(sql);
  }

  // Functions
  FUNCTION_REGEX.lastIndex = 0;
  m = FUNCTION_REGEX.exec(sql);
  while (m !== null) {
    const name = m[1].toLowerCase();
    functions[name] = { args: m[2].trim() };
    m = FUNCTION_REGEX.exec(sql);
  }

  // Triggers
  TRIGGER_REGEX.lastIndex = 0;
  m = TRIGGER_REGEX.exec(sql);
  while (m !== null) {
    const name = m[1].toLowerCase();
    const table = m[4].toLowerCase();
    const func = m[5].toLowerCase();
    triggers[name] = { table, function: func };
    m = TRIGGER_REGEX.exec(sql);
  }

  return { tables, indexes, functions, triggers };
}

function normalizeSchemaType(rawType) {
  const t = rawType.toUpperCase().replace(/\s+/g, ' ').trim();
  const simple = SIMPLE_TYPE_MAP[t];
  if (simple) {
    return simple.dataType;
  }
  const varcharMatch = t.match(/^VARCHAR\s*\(\s*(\d+)\s*\)$/);
  if (varcharMatch) {
    return 'character varying';
  }
  const decMatch = t.match(/^(?:DECIMAL|NUMERIC)\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (decMatch) {
    return 'numeric';
  }
  return t.toLowerCase();
}

// ─── Verification ────────────────────────────────────────────────────────────

async function checkTables(pool, expected) {
  const errors = [];
  const warnings = [];

  const { rows } = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
  );
  const dbTables = new Set(rows.map((r) => r.table_name));
  const expectedTables = new Set(Object.keys(expected.tables));

  for (const table of expectedTables) {
    if (!dbTables.has(table)) {
      errors.push(`Missing table: ${table}`);
    }
  }

  for (const table of dbTables) {
    if (!expectedTables.has(table)) {
      warnings.push(`Extra table in DB: ${table}`);
    }
  }

  return { errors, warnings, dbCount: dbTables.size, expectedCount: expectedTables.size };
}

async function checkColumns(pool, expected) {
  const errors = [];
  const warnings = [];

  const { rows } = await pool.query(
    "SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position",
  );

  const dbCols = {};
  for (const row of rows) {
    if (!dbCols[row.table_name]) {
      dbCols[row.table_name] = {};
    }
    dbCols[row.table_name][row.column_name] = row;
  }

  let expectedCount = 0;
  let matchedCount = 0;

  for (const [table, tableInfo] of Object.entries(expected.tables)) {
    const dbTableCols = dbCols[table];
    if (!dbTableCols) {
      continue;
    }

    for (const [colName, colSpec] of Object.entries(tableInfo.columns)) {
      expectedCount++;
      const dbCol = dbTableCols[colName];

      if (!dbCol) {
        errors.push(`Missing column: ${table}.${colName}`);
        continue;
      }

      const expectedType = normalizeSchemaType(colSpec.type);
      if (expectedType !== dbCol.data_type) {
        errors.push(
          `Type mismatch: ${table}.${colName} — expected ${colSpec.type} (${expectedType}), got ${dbCol.data_type}`,
        );
        continue;
      }

      const expectedNullable = !colSpec.notNull;
      const dbNullable = dbCol.is_nullable === 'YES';
      if (expectedNullable !== dbNullable) {
        errors.push(
          `Nullability mismatch: ${table}.${colName} — expected ${expectedNullable ? 'nullable' : 'NOT NULL'}, got ${dbNullable ? 'nullable' : 'NOT NULL'}`,
        );
        continue;
      }

      matchedCount++;
    }

    // Extra columns
    if (verbose) {
      for (const colName of Object.keys(dbTableCols)) {
        if (!tableInfo.columns[colName]) {
          warnings.push(
            `Extra column in DB: ${table}.${colName} (${dbTableCols[colName].data_type})`,
          );
        }
      }
    }
  }

  return { errors, warnings, expectedCount, matchedCount };
}

async function checkIndexes(pool, expected) {
  const errors = [];
  const warnings = [];

  const { rows } = await pool.query(
    "SELECT indexname, tablename FROM pg_indexes WHERE schemaname = 'public'",
  );
  const dbIndexes = new Map(rows.map((r) => [r.indexname, r.tablename]));

  for (const [indexName, indexSpec] of Object.entries(expected.indexes)) {
    if (!dbIndexes.has(indexName)) {
      errors.push(`Missing index: ${indexName} on ${indexSpec.table}`);
    }
  }

  return {
    errors,
    warnings,
    dbCount: dbIndexes.size,
    expectedCount: Object.keys(expected.indexes).length,
  };
}

async function checkFunctions(pool, expected) {
  const errors = [];

  const { rows } = await pool.query(
    "SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public'",
  );
  const dbFunctions = new Set(rows.map((r) => r.routine_name));

  for (const funcName of Object.keys(expected.functions)) {
    if (!dbFunctions.has(funcName)) {
      errors.push(`Missing function: ${funcName}`);
    }
  }

  return { errors };
}

async function checkTriggers(pool, expected) {
  const errors = [];

  const { rows } = await pool.query(
    "SELECT trigger_name, event_object_table FROM information_schema.triggers WHERE trigger_schema = 'public'",
  );
  const dbTriggers = new Map(rows.map((r) => [r.trigger_name, r.event_object_table]));

  for (const [triggerName, triggerSpec] of Object.entries(expected.triggers)) {
    if (!dbTriggers.has(triggerName)) {
      errors.push(`Missing trigger: ${triggerName} on ${triggerSpec.table}`);
    }
  }

  return { errors };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const schemaPath = path.resolve('schema.sql');
  if (!fs.existsSync(schemaPath)) {
    console.error('❌ schema.sql not found in repository root');
    process.exit(1);
  }

  console.log('🔍 Database Health Check — YapBay API\n');
  console.log(`📊 Database URL: ${databaseUrl.replace(URL_MASK_REGEX, ':****@')}`);
  console.log(`📊 Schema file: ${schemaPath}\n`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const sql = fs.readFileSync(schemaPath, 'utf8');
  const expected = parseSchema(sql);

  console.log(
    `📋 Parsed schema.sql: ${Object.keys(expected.tables).length} tables, ${Object.keys(expected.indexes).length} indexes, ${Object.keys(expected.functions).length} functions, ${Object.keys(expected.triggers).length} triggers\n`,
  );

  const pool = new Pool({ connectionString: databaseUrl });
  let totalErrors = 0;
  let totalWarnings = 0;

  try {
    // Check tables
    console.log('🔍 Checking tables...');
    const tableResult = await checkTables(pool, expected);
    totalErrors += tableResult.errors.length;
    totalWarnings += tableResult.warnings.length;
    if (tableResult.errors.length === 0) {
      console.log(
        `   ✅ All ${tableResult.expectedCount} expected tables present (${tableResult.dbCount} total in DB)`,
      );
    }
    for (const e of tableResult.errors) {
      console.log(`   ❌ ${e}`);
    }
    for (const w of tableResult.warnings) {
      console.log(`   ⚠️  ${w}`);
    }
    console.log('');

    // Check columns
    console.log('🔍 Checking columns...');
    const columnResult = await checkColumns(pool, expected);
    totalErrors += columnResult.errors.length;
    totalWarnings += columnResult.warnings.length;
    if (columnResult.errors.length === 0) {
      console.log(
        `   ✅ All ${columnResult.expectedCount} expected columns verified (${columnResult.matchedCount} matched)`,
      );
    }
    for (const e of columnResult.errors) {
      console.log(`   ❌ ${e}`);
    }
    for (const w of columnResult.warnings) {
      console.log(`   ⚠️  ${w}`);
    }
    console.log('');

    // Check indexes
    console.log('🔍 Checking indexes...');
    const indexResult = await checkIndexes(pool, expected);
    totalErrors += indexResult.errors.length;
    if (indexResult.errors.length === 0) {
      console.log(
        `   ✅ All ${indexResult.expectedCount} expected indexes present (${indexResult.dbCount} total in DB)`,
      );
    }
    for (const e of indexResult.errors) {
      console.log(`   ❌ ${e}`);
    }
    console.log('');

    // Check functions
    console.log('🔍 Checking functions...');
    const funcResult = await checkFunctions(pool, expected);
    totalErrors += funcResult.errors.length;
    if (funcResult.errors.length === 0) {
      console.log(`   ✅ All ${Object.keys(expected.functions).length} expected functions present`);
    }
    for (const e of funcResult.errors) {
      console.log(`   ❌ ${e}`);
    }
    console.log('');

    // Check triggers
    console.log('🔍 Checking triggers...');
    const trigResult = await checkTriggers(pool, expected);
    totalErrors += trigResult.errors.length;
    if (trigResult.errors.length === 0) {
      console.log(`   ✅ All ${Object.keys(expected.triggers).length} expected triggers present`);
    }
    for (const e of trigResult.errors) {
      console.log(`   ❌ ${e}`);
    }
    console.log('');

    // Summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    if (totalErrors === 0 && totalWarnings === 0) {
      console.log('✅ Database schema matches schema.sql — all checks passed!');
    } else if (totalErrors === 0) {
      console.log(`⚠️  Database schema mostly matches (${totalWarnings} warning(s), 0 errors)`);
    } else {
      console.log(`❌ Schema drift detected: ${totalErrors} error(s), ${totalWarnings} warning(s)`);
      console.log('\n💡 Fix drift by running missing migrations or updating schema.sql');
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (totalErrors > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`❌ Health check failed: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
