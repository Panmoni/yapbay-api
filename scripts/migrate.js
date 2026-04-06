#!/usr/bin/env node

/**
 * Database Migration Runner for YapBay API
 *
 * Features:
 * - Two-layer schema verification (regex + snapshot)
 * - Database identity verification
 * - Concurrency protection (PID file + advisory lock)
 * - Pre-flight anomaly detection
 * - SHA-256 checksum integrity verification
 * - Schema fingerprinting for drift detection
 * - Structured JSON logging (JSONL)
 * - Canary checks for record persistence
 * - Shell injection prevention (execFileSync, no shell interpolation)
 * - Rollback support via -- DOWN sections
 * - Backup creation (pg_dump)
 * - Dry-run and verify-only modes
 *
 * Adapted from bcp-api's enterprise migration runner for yapbay-api's single-DB setup.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Load environment
if (fs.existsSync('.env.local')) {
  require('dotenv').config({ path: '.env.local' });
}
require('dotenv').config();

// Configuration
const CONFIG = {
  migrationsDir: 'migrations',
  backupDir: 'backups',
  logFile: 'logs/migration.log',
  jsonLogFile: 'logs/migration.jsonl',
};

// Ensure logs directory exists
const logDir = path.dirname(CONFIG.logFile);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// ─── Safe psql execution (no shell interpolation) ────────────────────────────

function psqlExec(databaseUrl, args, options = {}) {
  return execFileSync('psql', [databaseUrl, ...args], options);
}

function psqlExecFile(databaseUrl, filePath, options = {}) {
  return execFileSync('psql', [databaseUrl, '--set', 'ON_ERROR_STOP=on', '-f', filePath], options);
}

function psqlExecStdin(databaseUrl, sql, args, options = {}) {
  return execFileSync('psql', [databaseUrl, ...args], { ...options, input: sql });
}

function pgDumpExec(databaseUrl, extraArgs = [], options = {}) {
  return execFileSync('pg_dump', [databaseUrl, ...extraArgs], options);
}

// ─── URL validation ──────────────────────────────────────────────────────────

const SAFE_DB_URL_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s`$;|&!(){}[\]<>'"\\]+$/;
const URL_MASK_REGEX = /:[^:@]+@/;
const MIGRATION_PATTERN = /^\d{4}-\d{4}-\d{2}-\d{2}-.+\.sql$/;

function validateDatabaseUrl(url) {
  if (!url) {
    return;
  }
  if (!SAFE_DB_URL_PATTERN.test(url)) {
    throw new Error(
      'DATABASE_URL contains disallowed characters. Only standard PostgreSQL URI characters are permitted.',
    );
  }
}

// ─── Logging ─────────────────────────────────────────────────────────────────

function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  fs.appendFileSync(CONFIG.logFile, `${logMessage}\n`);
}

function jsonLog(event, data = {}) {
  const entry = {
    ts: new Date().toISOString(),
    event,
    ...data,
  };
  fs.appendFileSync(CONFIG.jsonLogFile, `${JSON.stringify(entry)}\n`);
}

// ─── Database identity & state queries ───────────────────────────────────────

function queryConnectionIdentity(databaseUrl) {
  try {
    const result = psqlExec(
      databaseUrl,
      ['-t', '-A', '-c', 'SELECT current_database(), inet_server_addr(), pg_backend_pid()'],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    const parts = result.trim().split('|');
    return {
      database: parts[0] || 'unknown',
      server: parts[1] || 'unknown',
      pid: parts[2] || 'unknown',
    };
  } catch {
    return null;
  }
}

function getMigrationsTableHash(databaseUrl) {
  try {
    const result = psqlExec(
      databaseUrl,
      [
        '-t',
        '-A',
        '-c',
        "SELECT COALESCE(md5(string_agg(filename || '|' || applied_at::text, ',' ORDER BY filename)), 'EMPTY') FROM migrations",
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    return result.trim() || 'EMPTY';
  } catch {
    return 'ERROR';
  }
}

function getMigrationRecordCount(databaseUrl) {
  try {
    const result = psqlExec(databaseUrl, ['-t', '-A', '-c', 'SELECT COUNT(*) FROM migrations'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return Number.parseInt(result.trim(), 10);
  } catch {
    return -1;
  }
}

function computeSchemaFingerprint(databaseUrl) {
  try {
    const result = psqlExec(
      databaseUrl,
      [
        '-t',
        '-A',
        '-c',
        "SELECT md5(string_agg(table_name || '.' || column_name || '.' || data_type || '.' || COALESCE(column_default, 'NULL'), '|' ORDER BY table_name, ordinal_position)) FROM information_schema.columns WHERE table_schema = 'public'",
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    return result.trim() || 'EMPTY';
  } catch {
    return 'ERROR';
  }
}

function getLastRecordedSchemaFingerprint() {
  try {
    if (!fs.existsSync(CONFIG.jsonLogFile)) {
      return null;
    }
    const lines = fs.readFileSync(CONFIG.jsonLogFile, 'utf8').trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (
          entry.schema_fingerprint &&
          (entry.event === 'pre_run_state' || entry.event === 'post_run_state')
        ) {
          return {
            fingerprint: entry.schema_fingerprint,
            event: entry.event,
            ts: entry.ts,
            record_count: entry.record_count,
          };
        }
      } catch {
        /* ignore parse errors */
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Environment check ───────────────────────────────────────────────────────

function checkEnvironment() {
  const dbUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('Missing POSTGRES_URL or DATABASE_URL environment variable');
  }
  validateDatabaseUrl(dbUrl);
  const maskedUrl = dbUrl.replace(URL_MASK_REGEX, ':****@');
  log(`📊 Target database: ${maskedUrl}`);
  log('✅ Environment variables validated');
  return dbUrl;
}

// ─── Database identity verification ──────────────────────────────────────────

function verifyDatabaseIdentity(databaseUrl) {
  try {
    const result = psqlExec(
      databaseUrl,
      [
        '-t',
        '-A',
        '-c',
        'SELECT current_database(), inet_server_addr(), current_user, pg_backend_pid()',
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    const parts = result.trim().split('|');
    const currentDb = parts[0] || 'unknown';
    const serverAddr = parts[1] || 'unknown';
    const currentUser = parts[2] || 'unknown';
    const backendPid = parts[3] || 'unknown';

    log('🔍 Database identity check:');
    log(`   Database: ${currentDb}`);
    log(`   Server: ${serverAddr}`);
    log(`   User: ${currentUser}`);
    log(`   Backend PID: ${backendPid}`);

    jsonLog('identity_check', {
      database: currentDb,
      server: serverAddr,
      user: currentUser,
      pid: backendPid,
    });

    // Verify database name matches URL
    try {
      const url = new URL(databaseUrl);
      const expectedDb = url.pathname.replace('/', '');
      if (expectedDb && currentDb !== expectedDb) {
        throw new Error(
          `Database name mismatch! Expected "${expectedDb}" but connected to "${currentDb}".`,
        );
      }
    } catch (urlError) {
      if (urlError.message.includes('mismatch')) {
        throw urlError;
      }
    }

    log('✅ Database identity verified');
  } catch (error) {
    if (error.message.includes('mismatch')) {
      throw error;
    }
    log(`⚠️  Could not verify database identity: ${error.message}`);
  }
}

// ─── Backup ──────────────────────────────────────────────────────────────────

function createBackup(databaseUrl) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(CONFIG.backupDir, `backup_${timestamp}.sql`);

  if (!fs.existsSync(CONFIG.backupDir)) {
    fs.mkdirSync(CONFIG.backupDir, { recursive: true });
  }

  log('📦 Creating database backup...');
  try {
    pgDumpExec(databaseUrl, ['-f', backupFile], { stdio: 'pipe' });
    log(`✅ Backup created: ${backupFile}`);
    return backupFile;
  } catch (error) {
    throw new Error(`Failed to create backup: ${error.message}`);
  }
}

// ─── Migration file management ───────────────────────────────────────────────

function getMigrationFiles() {
  const migrationsPath = path.resolve(CONFIG.migrationsDir);
  if (!fs.existsSync(migrationsPath)) {
    throw new Error(`Migrations directory not found: ${migrationsPath}`);
  }

  const files = fs
    .readdirSync(migrationsPath)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    throw new Error(`No migration files found in ${migrationsPath}`);
  }

  // Validate naming convention
  const badFiles = files.filter((f) => !MIGRATION_PATTERN.test(f));
  if (badFiles.length > 0) {
    console.warn(
      `⚠️  Migration files with non-standard names (expected NNNN-YYYY-MM-DD-description.sql):\n${badFiles.map((f) => `   ${f}`).join('\n')}`,
    );
  }

  return files;
}

function getAppliedMigrations(databaseUrl) {
  try {
    const result = psqlExec(
      databaseUrl,
      ['-t', '-c', 'SELECT filename FROM migrations ORDER BY filename'],
      { encoding: 'utf8' },
    );
    return result
      .trim()
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => line.trim());
  } catch {
    log('⚠️  Migrations table not found, will create it');
    return [];
  }
}

function calculateChecksum(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

// ─── Migration recording with canary check ───────────────────────────────────

function recordMigration(databaseUrl, filename, checksum, executionTimeMs) {
  try {
    const query = `
      INSERT INTO migrations (filename, checksum, execution_time_ms, environment, created_at, applied_at)
      VALUES (:'v_filename', :'v_checksum', :'v_exec_time'::INTEGER, :'v_env', NOW(), NOW())
      ON CONFLICT (filename) DO UPDATE SET
        checksum = EXCLUDED.checksum,
        execution_time_ms = EXCLUDED.execution_time_ms,
        applied_at = NOW()
    `;
    psqlExecStdin(
      databaseUrl,
      query,
      [
        '-v',
        `v_filename=${filename.replace(/'/g, "''")}`,
        '-v',
        `v_checksum=${checksum.replace(/'/g, "''")}`,
        '-v',
        `v_exec_time=${executionTimeMs}`,
        '-v',
        'v_env=production',
      ],
      { stdio: 'pipe' },
    );

    // Canary check: verify the record we just wrote actually exists
    try {
      const canaryResult = psqlExecStdin(
        databaseUrl,
        "SELECT COUNT(*) FROM migrations WHERE filename = :'v_filename'",
        ['-v', `v_filename=${filename.replace(/'/g, "''")}`, '-t', '-A'],
        { encoding: 'utf8', stdio: 'pipe' },
      );
      const recordExists = Number.parseInt(canaryResult.trim(), 10) > 0;
      if (recordExists) {
        jsonLog('record_confirmed', { filename });
      } else {
        log(
          `🚨 CANARY FAILURE: Migration record for ${filename} was written but immediately NOT FOUND!`,
        );
        jsonLog('canary_failure', { filename, action: 'record_vanished_after_insert' });
      }
    } catch (canaryError) {
      log(`⚠️  Canary check failed for ${filename}: ${canaryError.message}`);
      jsonLog('canary_error', { filename, error: canaryError.message });
    }
  } catch (error) {
    log(`⚠️  Warning: Could not record migration ${filename}: ${error.message}`);
    jsonLog('record_failed', { filename, error: error.message });
  }
}

// ─── Schema change extraction ────────────────────────────────────────────────

const DDL_STATEMENT_REGEX =
  /\b(CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+INDEX|DROP\s+INDEX|CREATE\s+UNIQUE\s+INDEX|ADD\s+COLUMN|DROP\s+COLUMN|RENAME\s+COLUMN|ALTER\s+COLUMN|CREATE\s+EXTENSION|CREATE\s+FUNCTION|CREATE\s+OR\s+REPLACE\s+FUNCTION)\b/i;
const DOWN_MARKER_REGEX = /^-- DOWN\b/m;

function containsDDL(migrationPath) {
  const content = fs.readFileSync(migrationPath, 'utf8');
  const cleaned = content
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx >= 0 ? line.substring(0, idx) : line;
    })
    .join('\n');
  return DDL_STATEMENT_REGEX.test(cleaned);
}

function extractExpectedSchemaChanges(migrationPath) {
  let content = fs.readFileSync(migrationPath, 'utf8');
  const downIdx = content.search(DOWN_MARKER_REGEX);
  if (downIdx !== -1) {
    content = content.substring(0, downIdx).trimEnd();
  }

  const changes = { columns: [], indexes: [], tables: [] };

  // Extract ADD COLUMN statements
  const alterTableBlockRegex = /ALTER TABLE\s+(\w+)\s+([\s\S]*?);\s*/gi;
  let match = alterTableBlockRegex.exec(content);
  while (match !== null) {
    const tableName = match[1];
    const alterBody = match[2];
    const addColRegex = /ADD COLUMN\s+IF NOT EXISTS\s+(\w+)/gi;
    let colMatch = addColRegex.exec(alterBody);
    while (colMatch !== null) {
      changes.columns.push({ table: tableName, column: colMatch[1] });
      colMatch = addColRegex.exec(alterBody);
    }
    match = alterTableBlockRegex.exec(content);
  }

  // Extract CREATE INDEX statements
  const createIndexRegex = /CREATE INDEX\s+IF NOT EXISTS\s+(\w+)\s+ON\s+(\w+)/gi;
  match = createIndexRegex.exec(content);
  while (match !== null) {
    changes.indexes.push({ name: match[1], table: match[2] });
    match = createIndexRegex.exec(content);
  }

  // Extract CREATE TABLE statements
  const createTableRegex = /CREATE TABLE\s+IF NOT EXISTS\s+(\w+)/gi;
  match = createTableRegex.exec(content);
  while (match !== null) {
    changes.tables.push(match[1]);
    match = createTableRegex.exec(content);
  }

  return changes;
}

// ─── Schema snapshots for diff-based verification ────────────────────────────

function captureSchemaSnapshot(databaseUrl) {
  const snapshot = { columns: {}, indexes: {}, tables: [] };

  try {
    const columnsResult = psqlExec(
      databaseUrl,
      [
        '-t',
        '-A',
        '-c',
        "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position",
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    for (const line of columnsResult.trim().split('\n')) {
      if (!line.trim()) {
        continue;
      }
      const [table, column] = line.split('|');
      if (!(table && column)) {
        continue;
      }
      if (!snapshot.columns[table]) {
        snapshot.columns[table] = [];
      }
      snapshot.columns[table].push(column);
    }

    const indexesResult = psqlExec(
      databaseUrl,
      [
        '-t',
        '-A',
        '-c',
        "SELECT tablename, indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname",
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    for (const line of indexesResult.trim().split('\n')) {
      if (!line.trim()) {
        continue;
      }
      const [table, index] = line.split('|');
      if (!(table && index)) {
        continue;
      }
      if (!snapshot.indexes[table]) {
        snapshot.indexes[table] = [];
      }
      snapshot.indexes[table].push(index);
    }

    const tablesResult = psqlExec(
      databaseUrl,
      [
        '-t',
        '-A',
        '-c',
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    snapshot.tables = tablesResult
      .trim()
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => l.trim());
  } catch (error) {
    log(`⚠️  Warning: Could not capture schema snapshot: ${error.message}`);
  }

  return snapshot;
}

function diffSchemaSnapshots(before, after) {
  const diff = {
    addedColumns: [],
    removedColumns: [],
    addedIndexes: [],
    removedIndexes: [],
    addedTables: [],
    removedTables: [],
  };

  const beforeTables = new Set(before.tables);
  const afterTables = new Set(after.tables);
  for (const t of afterTables) {
    if (!beforeTables.has(t)) {
      diff.addedTables.push(t);
    }
  }
  for (const t of beforeTables) {
    if (!afterTables.has(t)) {
      diff.removedTables.push(t);
    }
  }

  const allTables = new Set([...Object.keys(before.columns), ...Object.keys(after.columns)]);
  for (const table of allTables) {
    const beforeCols = new Set(before.columns[table] || []);
    const afterCols = new Set(after.columns[table] || []);
    for (const col of afterCols) {
      if (!beforeCols.has(col)) {
        diff.addedColumns.push(`${table}.${col}`);
      }
    }
    for (const col of beforeCols) {
      if (!afterCols.has(col)) {
        diff.removedColumns.push(`${table}.${col}`);
      }
    }
  }

  const allIndexTables = new Set([...Object.keys(before.indexes), ...Object.keys(after.indexes)]);
  for (const table of allIndexTables) {
    const beforeIdx = new Set(before.indexes[table] || []);
    const afterIdx = new Set(after.indexes[table] || []);
    for (const idx of afterIdx) {
      if (!beforeIdx.has(idx)) {
        diff.addedIndexes.push(`${idx} on ${table}`);
      }
    }
    for (const idx of beforeIdx) {
      if (!afterIdx.has(idx)) {
        diff.removedIndexes.push(`${idx} on ${table}`);
      }
    }
  }

  return diff;
}

// ─── Pre-flight environment guard ────────────────────────────────────────────

function preFlightEnvironmentGuard(databaseUrl) {
  log('🛡️  Running pre-flight environment guard...');

  try {
    const guardIdentity = queryConnectionIdentity(databaseUrl);
    if (guardIdentity) {
      log(
        `   📍 Guard check against: ${guardIdentity.database}@${guardIdentity.server} (pid ${guardIdentity.pid})`,
      );
    }

    // Check if core application tables exist
    const tablesResult = psqlExec(
      databaseUrl,
      [
        '-t',
        '-A',
        '-c',
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('accounts', 'offers', 'trades', 'escrows')",
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    const coreTableCount = Number.parseInt(tablesResult.trim(), 10);

    if (coreTableCount === 0) {
      log('   ✅ Fresh database detected — no guard checks needed');
      jsonLog('preflight_guard', { result: 'fresh_database', core_tables: 0 });
      return;
    }

    // Check if migrations table exists
    const migrationsTableResult = psqlExec(
      databaseUrl,
      [
        '-t',
        '-A',
        '-c',
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'migrations'",
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    const hasMigrationsTable = Number.parseInt(migrationsTableResult.trim(), 10) > 0;

    if (!hasMigrationsTable) {
      throw new Error(
        `ANOMALY DETECTED: Core application tables exist (${coreTableCount}/4) but the ` +
          'migrations table is MISSING. This typically means schema.sql was run against ' +
          'this database. Manual investigation required.',
      );
    }

    const migrationCountResult = psqlExec(
      databaseUrl,
      ['-t', '-A', '-c', 'SELECT COUNT(*) FROM migrations'],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    const appliedCount = Number.parseInt(migrationCountResult.trim(), 10);
    const migrationFiles = getMigrationFiles();
    const fileCount = migrationFiles.length;

    if (coreTableCount >= 3 && appliedCount === 0) {
      throw new Error(
        'ANOMALY DETECTED: Core application tables exist but migrations table has 0 records. ' +
          `If migrations run now, all ${fileCount} migrations will re-execute against an ` +
          'existing schema, which may cause data corruption. Manual investigation required.',
      );
    }

    const pendingCount = fileCount - appliedCount;
    if (pendingCount > 20 && appliedCount > 0) {
      log(
        `   ⚠️  WARNING: ${pendingCount} pending migrations detected (${appliedCount} applied, ${fileCount} files). ` +
          'This is unusually high. Verify the migrations table is intact.',
      );
    }

    log(`   ✅ Environment guard passed (${appliedCount} applied, ${pendingCount} pending)`);
    jsonLog('preflight_guard', {
      result: 'passed',
      core_tables: coreTableCount,
      applied: appliedCount,
      pending: pendingCount,
      total_files: fileCount,
      database: guardIdentity?.database,
      server: guardIdentity?.server,
    });
  } catch (error) {
    if (error.message.startsWith('ANOMALY DETECTED')) {
      log(`\n❌ ${error.message}`);
      jsonLog('preflight_guard', { result: 'anomaly', error: error.message });
      throw error;
    }
    log(`   ⚠️  Environment guard check had a non-fatal error: ${error.message}`);
    jsonLog('preflight_guard', { result: 'non_fatal_error', error: error.message });
  }
}

// ─── Concurrency protection ──────────────────────────────────────────────────

const MIGRATION_LOCK_KEY = 839_274_651;
const LOCK_FILE_PATH = path.resolve('logs', '.migration.lock');

function acquireLocalLock() {
  try {
    if (fs.existsSync(LOCK_FILE_PATH)) {
      const existingPid = fs.readFileSync(LOCK_FILE_PATH, 'utf8').trim();
      let isStale = true;
      if (existingPid) {
        try {
          process.kill(Number(existingPid), 0);
          isStale = false;
        } catch {
          isStale = true;
        }
      }
      if (!isStale) {
        log(`⚠️  Another migration process is running locally (PID ${existingPid})`);
        return false;
      }
      log(`🧹 Removing stale lock file (PID ${existingPid} no longer running)`);
      fs.unlinkSync(LOCK_FILE_PATH);
    }
    fs.writeFileSync(LOCK_FILE_PATH, String(process.pid));
    return true;
  } catch (error) {
    log(`⚠️  Could not acquire local lock: ${error.message}`);
    return false;
  }
}

function releaseLocalLock() {
  try {
    if (fs.existsSync(LOCK_FILE_PATH)) {
      const filePid = fs.readFileSync(LOCK_FILE_PATH, 'utf8').trim();
      if (filePid === String(process.pid)) {
        fs.unlinkSync(LOCK_FILE_PATH);
      }
    }
  } catch {
    /* best effort */
  }
}

function probeDatabaseLock(databaseUrl) {
  try {
    const result = psqlExec(
      databaseUrl,
      [
        '-t',
        '-A',
        '-c',
        `SELECT pg_try_advisory_lock(${MIGRATION_LOCK_KEY}) AS acquired; SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY});`,
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    return result.trim().split('\n')[0] === 't';
  } catch (error) {
    log(`⚠️  Could not probe database advisory lock: ${error.message}`);
    return true;
  }
}

function acquireMigrationLock(databaseUrl) {
  if (!acquireLocalLock()) {
    return false;
  }
  if (!probeDatabaseLock(databaseUrl)) {
    releaseLocalLock();
    log('⚠️  Another migration process is holding the database advisory lock');
    return false;
  }
  return true;
}

function releaseMigrationLock() {
  releaseLocalLock();
}

// ─── Main migration execution ────────────────────────────────────────────────

function runMigrations(databaseUrl) {
  const migrationFiles = getMigrationFiles();
  const appliedMigrations = getAppliedMigrations(databaseUrl);
  const pendingMigrations = migrationFiles.filter((file) => !appliedMigrations.includes(file));

  if (pendingMigrations.length === 0) {
    log('✅ No pending migrations found');
    return;
  }

  // Capture pre-run state
  const preRunRecordCount = getMigrationRecordCount(databaseUrl);
  const preRunHash = getMigrationsTableHash(databaseUrl);
  const preRunIdentity = queryConnectionIdentity(databaseUrl);
  const preRunSchemaFingerprint = computeSchemaFingerprint(databaseUrl);
  log(`📊 Pre-run state: ${preRunRecordCount} records, hash=${preRunHash.substring(0, 12)}...`);
  log(`📊 Schema fingerprint: ${preRunSchemaFingerprint.substring(0, 12)}...`);
  if (preRunIdentity) {
    log(
      `📍 Connected to: ${preRunIdentity.database}@${preRunIdentity.server} (pid ${preRunIdentity.pid})`,
    );
  }

  // Cross-run drift detection
  const lastRecorded = getLastRecordedSchemaFingerprint();
  if (lastRecorded && lastRecorded.fingerprint !== preRunSchemaFingerprint) {
    log(
      '⚠️  SCHEMA DRIFT DETECTED: Schema fingerprint changed between runs!\n' +
        `   Last recorded: ${lastRecorded.fingerprint.substring(0, 12)}... (${lastRecorded.ts})\n` +
        `   Current:       ${preRunSchemaFingerprint.substring(0, 12)}...`,
    );
    jsonLog('schema_drift_detected', {
      last_fingerprint: lastRecorded.fingerprint,
      current_fingerprint: preRunSchemaFingerprint,
      last_ts: lastRecorded.ts,
    });
  }

  jsonLog('pre_run_state', {
    record_count: preRunRecordCount,
    table_hash: preRunHash,
    schema_fingerprint: preRunSchemaFingerprint,
    pending_count: pendingMigrations.length,
    applied_count: appliedMigrations.length,
    total_files: migrationFiles.length,
    database: preRunIdentity?.database,
    server: preRunIdentity?.server,
    pid: preRunIdentity?.pid,
  });

  log(`🚀 Running ${pendingMigrations.length} pending migration(s)...`);
  log(`📋 Applied migrations: ${appliedMigrations.length}`);
  log(`📋 Pending migrations: ${pendingMigrations.join(', ')}`);

  for (const migrationFile of pendingMigrations) {
    const migrationPath = path.resolve(CONFIG.migrationsDir, migrationFile);
    const startTime = Date.now();
    const isDDL = containsDDL(migrationPath);

    log(`📄 Running migration: ${migrationFile}${isDDL ? ' (DDL)' : ' (data-only)'}`);
    jsonLog('migration_executing', { filename: migrationFile, isDDL });

    try {
      // Re-verify database identity before each migration
      const midRunIdentity = queryConnectionIdentity(databaseUrl);
      if (midRunIdentity && preRunIdentity && midRunIdentity.database !== preRunIdentity.database) {
        throw new Error(
          `DATABASE ROUTING CHANGED! Was "${preRunIdentity.database}" at start, now "${midRunIdentity.database}". Aborting.`,
        );
      }

      // Extract expected schema changes (regex-based)
      const expectedChanges = extractExpectedSchemaChanges(migrationPath);

      // Capture schema snapshot BEFORE migration (for DDL migrations)
      let snapshotBefore = null;
      if (isDDL) {
        log('   📸 Capturing pre-migration schema snapshot...');
        snapshotBefore = captureSchemaSnapshot(databaseUrl);
      }

      // Execute migration with ON_ERROR_STOP, stripping -- DOWN section
      try {
        let migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        const downMarkerMatch = migrationSQL.match(DOWN_MARKER_REGEX);
        if (downMarkerMatch) {
          migrationSQL = migrationSQL.substring(0, downMarkerMatch.index).trimEnd();
        }
        psqlExecStdin(databaseUrl, migrationSQL, ['--set', 'ON_ERROR_STOP=on'], {
          encoding: 'utf8',
          stdio: ['pipe', 'inherit', 'inherit'],
        });
      } catch (error) {
        const errorMessage =
          error.stderr?.toString() || error.stdout?.toString() || error.message || 'Unknown error';
        log(`❌ Migration execution failed: ${errorMessage}`);
        throw new Error(`Migration SQL execution failed: ${errorMessage}`);
      }

      // VERIFICATION LAYER 1: Regex-based
      if (
        expectedChanges.columns.length > 0 ||
        expectedChanges.indexes.length > 0 ||
        expectedChanges.tables.length > 0
      ) {
        log(`🔍 Verifying expected schema changes for ${migrationFile}...`);
        const missing = [];

        for (const { table, column } of expectedChanges.columns) {
          try {
            const columnResult = psqlExec(
              databaseUrl,
              [
                '-t',
                '-c',
                `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}' AND column_name = '${column}'`,
              ],
              { encoding: 'utf8', stdio: 'pipe' },
            );
            if (!columnResult.trim()) {
              missing.push(`Column ${table}.${column}`);
            }
          } catch {
            missing.push(`Column ${table}.${column} (verification error)`);
          }
        }

        for (const { name, table } of expectedChanges.indexes) {
          try {
            const indexResult = psqlExec(
              databaseUrl,
              [
                '-t',
                '-c',
                `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = '${table}' AND indexname = '${name}'`,
              ],
              { encoding: 'utf8', stdio: 'pipe' },
            );
            if (!indexResult.trim()) {
              missing.push(`Index ${name} on ${table}`);
            }
          } catch {
            missing.push(`Index ${name} on ${table} (verification error)`);
          }
        }

        for (const table of expectedChanges.tables) {
          try {
            const tableResult = psqlExec(
              databaseUrl,
              [
                '-t',
                '-c',
                `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${table}'`,
              ],
              { encoding: 'utf8', stdio: 'pipe' },
            );
            if (!tableResult.trim()) {
              missing.push(`Table ${table}`);
            }
          } catch {
            missing.push(`Table ${table} (verification error)`);
          }
        }

        if (missing.length > 0) {
          throw new Error(`Schema verification failed. Missing: ${missing.join(', ')}`);
        }
        log('   ✅ Regex-based verification passed');
      }

      // VERIFICATION LAYER 2: Snapshot diff
      if (isDDL && snapshotBefore) {
        log('   📸 Capturing post-migration schema snapshot...');
        const snapshotAfter = captureSchemaSnapshot(databaseUrl);
        const schemaDiff = diffSchemaSnapshots(snapshotBefore, snapshotAfter);

        const totalChanges =
          schemaDiff.addedColumns.length +
          schemaDiff.removedColumns.length +
          schemaDiff.addedIndexes.length +
          schemaDiff.removedIndexes.length +
          schemaDiff.addedTables.length +
          schemaDiff.removedTables.length;

        if (totalChanges === 0) {
          log('   ⚠️  DDL migration produced no schema changes — migration may be a no-op');
        } else {
          log(`   📊 Schema diff: ${totalChanges} change(s) detected`);
          if (schemaDiff.addedTables.length > 0) {
            log(`      + Tables added: ${schemaDiff.addedTables.join(', ')}`);
          }
          if (schemaDiff.removedTables.length > 0) {
            log(`      - Tables removed: ${schemaDiff.removedTables.join(', ')}`);
          }
          if (schemaDiff.addedColumns.length > 0) {
            log(`      + Columns added: ${schemaDiff.addedColumns.join(', ')}`);
          }
          if (schemaDiff.removedColumns.length > 0) {
            log(`      - Columns removed: ${schemaDiff.removedColumns.join(', ')}`);
          }
          if (schemaDiff.addedIndexes.length > 0) {
            log(`      + Indexes added: ${schemaDiff.addedIndexes.join(', ')}`);
          }
          if (schemaDiff.removedIndexes.length > 0) {
            log(`      - Indexes removed: ${schemaDiff.removedIndexes.join(', ')}`);
          }
        }

        // Detect unexpected removals
        const migrationContent = fs.readFileSync(migrationPath, 'utf8');
        const expectedDroppedTables = new Set();

        if (schemaDiff.removedTables.length > 0) {
          const unexpectedTableRemovals = schemaDiff.removedTables.filter((table) => {
            const dropPattern = new RegExp(`DROP\\s+TABLE\\s+(IF\\s+EXISTS\\s+)?${table}\\b`, 'i');
            const isExpected = dropPattern.test(migrationContent);
            if (isExpected) {
              expectedDroppedTables.add(table);
            }
            return !isExpected;
          });
          if (unexpectedTableRemovals.length > 0) {
            throw new Error(
              `Schema regression detected! Tables unexpectedly removed: ${unexpectedTableRemovals.join(', ')}`,
            );
          }
        }

        if (schemaDiff.removedColumns.length > 0) {
          const unexpectedRemovals = schemaDiff.removedColumns.filter((colSpec) => {
            const table = colSpec.split('.')[0];
            const column = colSpec.split('.')[1];
            if (expectedDroppedTables.has(table)) {
              return false;
            }
            const dropPattern = new RegExp(
              `DROP\\s+COLUMN\\s+(IF\\s+EXISTS\\s+)?${column}\\b`,
              'i',
            );
            const renamePattern = new RegExp(`RENAME\\s+COLUMN\\s+${column}\\s+TO\\s+`, 'i');
            return !(dropPattern.test(migrationContent) || renamePattern.test(migrationContent));
          });
          if (unexpectedRemovals.length > 0) {
            throw new Error(
              `Schema regression detected! Columns unexpectedly removed: ${unexpectedRemovals.join(', ')}`,
            );
          }
        }

        log('   ✅ Snapshot-based verification passed');
      }

      const executionTime = Date.now() - startTime;
      const checksum = calculateChecksum(migrationPath);
      recordMigration(databaseUrl, migrationFile, checksum, executionTime);
      log(`✅ Migration ${migrationFile} completed successfully (${executionTime}ms)`);
      jsonLog('migration_applied', { filename: migrationFile, execution_time_ms: executionTime });
    } catch (error) {
      log(`❌ Migration ${migrationFile} failed: ${error.message}`);
      throw new Error(`Migration ${migrationFile} failed: ${error.message}`);
    }
  }

  log('✅ All pending migrations completed successfully');

  // Post-run verification
  const postRunRecordCount = getMigrationRecordCount(databaseUrl);
  const postRunHash = getMigrationsTableHash(databaseUrl);
  const postRunIdentity = queryConnectionIdentity(databaseUrl);
  const postRunSchemaFingerprint = computeSchemaFingerprint(databaseUrl);
  const expectedCount = preRunRecordCount + pendingMigrations.length;
  log(
    `📊 Post-run state: ${postRunRecordCount} records (expected ${expectedCount}), hash=${postRunHash.substring(0, 12)}...`,
  );
  log(`📊 Schema fingerprint: ${postRunSchemaFingerprint.substring(0, 12)}...`);

  jsonLog('post_run_state', {
    record_count: postRunRecordCount,
    expected_count: expectedCount,
    table_hash: postRunHash,
    schema_fingerprint: postRunSchemaFingerprint,
    database: postRunIdentity?.database,
    server: postRunIdentity?.server,
    pid: postRunIdentity?.pid,
  });

  if (postRunRecordCount !== expectedCount) {
    log(
      `🚨 RECORD COUNT MISMATCH: Expected ${expectedCount} records, found ${postRunRecordCount}.`,
    );
    jsonLog('record_count_mismatch', {
      expected: expectedCount,
      actual: postRunRecordCount,
      pre_run: preRunRecordCount,
      applied_this_run: pendingMigrations.length,
    });
  }

  if (preRunIdentity && postRunIdentity && preRunIdentity.database !== postRunIdentity.database) {
    log('🚨 DATABASE IDENTITY CHANGED during migration run!');
    jsonLog('identity_changed_during_run', { before: preRunIdentity, after: postRunIdentity });
  }
}

// ─── Verify migrations (read-only) ──────────────────────────────────────────

function verifyMigrations(databaseUrl) {
  log('🔍 Verifying migrations...');

  const verificationQueries = [
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'",
    "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public'",
    "SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public'",
  ];

  try {
    for (const query of verificationQueries) {
      const result = psqlExec(databaseUrl, ['-t', '-c', query], { encoding: 'utf8' });
      if (!result.trim() || result.trim() === '0') {
        log(`⚠️  Warning: Verification query returned empty result: ${query}`);
      }
    }
    log('✅ Migration verification completed');
  } catch (error) {
    log(`⚠️  Migration verification warning: ${error.message}`);
  }
}

// ─── Show migration status ───────────────────────────────────────────────────

function showMigrationStatus(databaseUrl) {
  log('📊 Migration status:');

  const migrationFiles = getMigrationFiles();
  const appliedMigrations = getAppliedMigrations(databaseUrl);

  log(`📋 Total migration files: ${migrationFiles.length}`);
  log(`📋 Applied migrations: ${appliedMigrations.length}`);
  log(`📋 Pending migrations: ${migrationFiles.length - appliedMigrations.length}`);

  if (appliedMigrations.length > 0) {
    log('\n✅ Applied migrations:');
    for (const migration of appliedMigrations) {
      log(`   - ${migration}`);
    }
  }

  const pendingMigrations = migrationFiles.filter((file) => !appliedMigrations.includes(file));
  if (pendingMigrations.length > 0) {
    log('\n⏳ Pending migrations:');
    for (const migration of pendingMigrations) {
      log(`   - ${migration}`);
    }
  } else {
    log('\n✅ All migrations are up to date!');
  }
}

// ─── Rollback ────────────────────────────────────────────────────────────────

function rollbackMigration(databaseUrl, migrationFile) {
  const migrationPath = path.resolve(CONFIG.migrationsDir, migrationFile);

  if (!fs.existsSync(migrationPath)) {
    throw new Error(`Migration file not found: ${migrationFile}`);
  }

  const content = fs.readFileSync(migrationPath, 'utf8');
  const downMarkerIndex = content.indexOf('-- DOWN');

  if (downMarkerIndex === -1) {
    throw new Error(`Migration ${migrationFile} has no -- DOWN section. Cannot roll back.`);
  }

  const downSQL = content.substring(downMarkerIndex + '-- DOWN'.length).trim();
  if (!downSQL) {
    throw new Error(`Migration ${migrationFile} has an empty -- DOWN section.`);
  }

  log(`🔄 Rolling back migration: ${migrationFile}`);
  log(`📄 Down SQL (${downSQL.split('\n').length} lines):`);

  const tempFile = path.resolve(CONFIG.migrationsDir, `.rollback_${Date.now()}.sql`);
  try {
    fs.writeFileSync(tempFile, downSQL);
    psqlExecFile(databaseUrl, tempFile, { encoding: 'utf8', stdio: 'inherit' });

    // Remove the migration record
    psqlExecStdin(
      databaseUrl,
      "DELETE FROM migrations WHERE filename = :'mig_filename';",
      ['-v', `mig_filename=${migrationFile}`],
      { stdio: 'pipe' },
    );

    log(`✅ Rollback of ${migrationFile} completed successfully`);
  } catch (error) {
    const errorMessage =
      error.stderr?.toString() || error.stdout?.toString() || error.message || 'Unknown error';
    throw new Error(`Rollback of ${migrationFile} failed: ${errorMessage}`);
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  let databaseUrl = null;
  let lockAcquired = false;

  try {
    log('🔄 Starting database migration');
    jsonLog('migration_start', { pid: process.pid });

    databaseUrl = checkEnvironment();
    verifyDatabaseIdentity(databaseUrl);

    // Acquire advisory lock
    log('🔒 Acquiring migration lock...');
    lockAcquired = acquireMigrationLock(databaseUrl);
    if (!lockAcquired) {
      throw new Error('Another migration process is currently running against this database.');
    }
    log('   ✅ Migration lock acquired');

    // Pre-flight guard
    preFlightEnvironmentGuard(databaseUrl);

    // Create backup
    const backupFile = createBackup(databaseUrl);

    // Run migrations
    runMigrations(databaseUrl);

    // Verify
    verifyMigrations(databaseUrl);

    log('🎉 Migration completed successfully!');
    jsonLog('migration_complete', { result: 'success' });
    if (backupFile) {
      log(`📁 Backup location: ${backupFile}`);
    }
    log('📋 Next steps:');
    log('   1. Test API functionality');
    log('   2. Monitor logs for any issues');
  } catch (error) {
    log(`❌ Migration failed: ${error.message}`);
    log('🔄 Consider restoring from backup if needed');
    jsonLog('migration_complete', { result: 'failed', error: error.message });
    process.exit(1);
  } finally {
    if (lockAcquired) {
      releaseMigrationLock();
      log('🔓 Migration lock released');
    }
  }
}

// ─── CLI argument handling ───────────────────────────────────────────────────

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Database Migration Runner — YapBay API

Usage: node scripts/migrate.js [options]

Options:
  --help, -h          Show this help message
  --dry-run           Show what would be done without executing
  --backup-only       Only create backup, don't run migration
  --status            Show migration status
  --verify-only       Verify migration records and schema state (read-only)
  --rollback <file>   Roll back a specific migration using its -- DOWN section

Environment Variables:
  POSTGRES_URL or DATABASE_URL   PostgreSQL connection string (loaded from .env)

Examples:
  node scripts/migrate.js                                    # Run pending migrations
  node scripts/migrate.js --status                           # Show status
  node scripts/migrate.js --dry-run                          # Dry run
  node scripts/migrate.js --verify-only                      # Verify only
  node scripts/migrate.js --rollback 0021-2025-04-29-add-missing-columns.sql
  `);
  process.exit(0);
}

if (process.argv.includes('--dry-run')) {
  log('🔍 Dry run mode - showing what would be done:');
  try {
    const databaseUrl = checkEnvironment();
    showMigrationStatus(databaseUrl);
  } catch (error) {
    log(`❌ Dry run failed: ${error.message}`);
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv.includes('--status')) {
  try {
    const databaseUrl = checkEnvironment();
    showMigrationStatus(databaseUrl);
  } catch (error) {
    log(`❌ Status check failed: ${error.message}`);
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv.includes('--backup-only')) {
  try {
    const databaseUrl = checkEnvironment();
    createBackup(databaseUrl);
  } catch (error) {
    log(`❌ Backup failed: ${error.message}`);
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv.includes('--verify-only')) {
  try {
    const databaseUrl = checkEnvironment();
    verifyDatabaseIdentity(databaseUrl);

    const identity = queryConnectionIdentity(databaseUrl);
    const recordCount = getMigrationRecordCount(databaseUrl);
    const tableHash = getMigrationsTableHash(databaseUrl);
    const schemaFingerprint = computeSchemaFingerprint(databaseUrl);

    log(`📊 Database: ${identity?.database || 'unknown'}`);
    log(`📊 Migration records: ${recordCount}`);
    log(`📊 Table hash: ${tableHash.substring(0, 12)}...`);
    log(`📊 Schema fingerprint: ${schemaFingerprint.substring(0, 12)}...`);

    showMigrationStatus(databaseUrl);
    verifyMigrations(databaseUrl);

    jsonLog('verify_only', {
      record_count: recordCount,
      table_hash: tableHash,
      schema_fingerprint: schemaFingerprint,
      database: identity?.database,
    });
  } catch (error) {
    log(`❌ Verification failed: ${error.message}`);
    process.exit(1);
  }
  process.exit(0);
}

const rollbackIndex = process.argv.indexOf('--rollback');
if (rollbackIndex !== -1) {
  const migrationFile = process.argv[rollbackIndex + 1];
  if (!migrationFile) {
    console.error('Error: --rollback requires a migration filename');
    process.exit(1);
  }
  try {
    const databaseUrl = checkEnvironment();
    verifyDatabaseIdentity(databaseUrl);
    rollbackMigration(databaseUrl, migrationFile);
  } catch (error) {
    log(`❌ Rollback failed: ${error.message}`);
    process.exit(1);
  }
  process.exit(0);
}

// Default: run migrations
main();
