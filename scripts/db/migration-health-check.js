#!/usr/bin/env node

/**
 * Migration Health Check — YapBay API
 *
 * Compares migration tracking records with actual database schema
 * to detect discrepancies that could indicate failed migrations.
 *
 * Features:
 * - Schema verification (CREATE TABLE, ADD COLUMN, CREATE INDEX)
 * - SHA-256 checksum verification
 * - Schema fingerprint drift detection
 * - Categorized issue reporting (errors vs warnings)
 *
 * Usage:
 *   node scripts/db/migration-health-check.js
 */

const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Load environment
if (fs.existsSync('.env.local')) {
  require('dotenv').config({ path: '.env.local' });
}
require('dotenv').config();

const URL_MASK_REGEX = /:[^:@]+@/;

const databaseUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('❌ Missing POSTGRES_URL or DATABASE_URL environment variable');
  process.exit(1);
}

/**
 * Extract expected schema changes from migration file
 */
function extractExpectedSchemaChanges(migrationPath) {
  const content = fs.readFileSync(migrationPath, 'utf8');
  const changes = {
    columns: [],
    indexes: [],
    tables: [],
    temporaryColumns: [],
    droppedColumns: [],
    droppedIndexes: [],
  };

  // Remove SQL comments
  const lines = content.split('\n');
  const cleanedLines = lines.map((line) => {
    const commentIndex = line.indexOf('--');
    if (commentIndex >= 0) {
      const beforeComment = line.substring(0, commentIndex);
      if (!beforeComment.includes("'") || beforeComment.split("'").length % 2 === 1) {
        return line.substring(0, commentIndex);
      }
    }
    return line;
  });
  const cleanedContent = cleanedLines.join('\n');

  // Extract ADD COLUMN statements
  const alterTableBlockRegex = /ALTER TABLE\s+(\w+)\s+([\s\S]*?);\s*/gi;
  let match = alterTableBlockRegex.exec(cleanedContent);
  while (match !== null) {
    const tableName = match[1];
    const alterBody = match[2];
    const addColRegex = /ADD COLUMN\s+IF NOT EXISTS\s+(\w+)/gi;
    let colMatch = addColRegex.exec(alterBody);
    while (colMatch !== null) {
      changes.columns.push({ table: tableName, column: colMatch[1] });
      colMatch = addColRegex.exec(alterBody);
    }
    match = alterTableBlockRegex.exec(cleanedContent);
  }

  // Extract CREATE INDEX statements
  const createIndexRegex = /^[^-]*CREATE\s+INDEX\s+IF NOT EXISTS\s+(\w+)\s+ON\s+(\w+)/gim;
  match = createIndexRegex.exec(cleanedContent);
  while (match !== null) {
    changes.indexes.push({ name: match[1], table: match[2] });
    match = createIndexRegex.exec(cleanedContent);
  }

  // Extract CREATE TABLE statements
  const createTableRegex = /CREATE TABLE\s+IF NOT EXISTS\s+(\w+)/gi;
  match = createTableRegex.exec(cleanedContent);
  while (match !== null) {
    changes.tables.push(match[1]);
    match = createTableRegex.exec(cleanedContent);
  }

  // Detect temporary columns
  const renamePattern = /RENAME\s+COLUMN\s+(\w+)\s+TO\s+(\w+)/gi;
  const dropColumnPattern = /DROP\s+COLUMN\s+IF EXISTS\s+(\w+)|DROP\s+COLUMN\s+(\w+)/gi;

  match = renamePattern.exec(cleanedContent);
  while (match !== null) {
    changes.temporaryColumns.push({
      oldName: match[1],
      newName: match[2],
      type: 'renamed',
    });
    match = renamePattern.exec(cleanedContent);
  }

  match = dropColumnPattern.exec(cleanedContent);
  while (match !== null) {
    const columnName = match[1] || match[2];
    const wasAdded = changes.columns.some((c) => c.column === columnName);
    if (wasAdded) {
      changes.temporaryColumns.push({ oldName: columnName, type: 'dropped' });
    } else {
      changes.droppedColumns.push(columnName);
    }
    match = dropColumnPattern.exec(cleanedContent);
  }

  // Detect dropped indexes
  const dropIndexPattern = /DROP\s+INDEX\s+IF EXISTS\s+(\w+)|DROP\s+INDEX\s+(\w+)/gi;
  match = dropIndexPattern.exec(cleanedContent);
  while (match !== null) {
    const indexName = match[1] || match[2];
    const wasCreated = changes.indexes.some((i) => i.name === indexName);
    if (wasCreated) {
      changes.indexes = changes.indexes.filter((i) => i.name !== indexName);
    } else {
      changes.droppedIndexes.push(indexName);
    }
    match = dropIndexPattern.exec(cleanedContent);
  }

  return changes;
}

function calculateChecksum(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function getAppliedMigrations(pool) {
  const result = await pool.query(
    'SELECT filename, checksum, applied_at, environment FROM migrations ORDER BY applied_at',
  );
  return result.rows;
}

/**
 * Check if schema changes exist in database
 */
async function verifySchemaChanges(pool, expectedChanges, migrationFilename, allMigrations) {
  const missing = [];
  const temporaryColumnNames = new Set(expectedChanges.temporaryColumns.map((tc) => tc.oldName));

  // Check for columns/indexes/tables modified by later migrations
  const replacedIndexes = new Set();
  const renamedOrDroppedColumns = new Set();
  const droppedTables = new Set();
  const currentMigrationIndex = allMigrations.findIndex((m) => m.filename === migrationFilename);

  if (currentMigrationIndex >= 0) {
    for (let i = currentMigrationIndex + 1; i < allMigrations.length; i++) {
      const laterMigration = allMigrations[i];
      const laterMigrationPath = path.join('migrations', laterMigration.filename);
      if (fs.existsSync(laterMigrationPath)) {
        const laterContent = fs.readFileSync(laterMigrationPath, 'utf8');

        for (const table of expectedChanges.tables) {
          const dropTableRegex = new RegExp(
            `DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?${table}\\b`,
            'i',
          );
          if (dropTableRegex.test(laterContent)) {
            droppedTables.add(table);
          }
        }

        for (const { name } of expectedChanges.indexes) {
          if (laterContent.includes('DROP INDEX') && laterContent.includes(name)) {
            replacedIndexes.add(name);
          }
        }

        for (const { column } of expectedChanges.columns) {
          const renameRegex = new RegExp(`RENAME\\s+COLUMN\\s+${column}\\s+TO\\s+\\w+`, 'i');
          if (renameRegex.test(laterContent)) {
            renamedOrDroppedColumns.add(column);
          }
          const dropRegex = new RegExp(`DROP\\s+COLUMN\\s+(?:IF\\s+EXISTS\\s+)?${column}\\b`, 'i');
          if (dropRegex.test(laterContent)) {
            renamedOrDroppedColumns.add(column);
          }
        }
      }
    }
  }

  // Verify columns
  for (const { table, column } of expectedChanges.columns) {
    if (temporaryColumnNames.has(column)) {
      continue;
    }
    if (droppedTables.has(table)) {
      continue;
    }
    if (renamedOrDroppedColumns.has(column)) {
      continue;
    }

    const result = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2",
      [table, column],
    );
    if (result.rows.length === 0) {
      missing.push({ type: 'column', name: `${table}.${column}` });
    }
  }

  // Verify indexes
  for (const { name, table } of expectedChanges.indexes) {
    if (replacedIndexes.has(name)) {
      continue;
    }
    if (droppedTables.has(table)) {
      continue;
    }

    const result = await pool.query(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1 AND indexname = $2",
      [table, name],
    );
    if (result.rows.length === 0) {
      missing.push({ type: 'index', name: `${name} on ${table}` });
    }
  }

  // Verify tables
  for (const table of expectedChanges.tables) {
    if (droppedTables.has(table)) {
      continue;
    }

    const result = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1",
      [table],
    );
    if (result.rows.length === 0) {
      missing.push({ type: 'table', name: table });
    }
  }

  return missing;
}

/**
 * Main health check function
 */
async function main() {
  console.log('🔍 Migration Health Check\n');
  console.log(`📊 Database URL: ${databaseUrl.replace(URL_MASK_REGEX, ':****@')}\n`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const appliedMigrations = await getAppliedMigrations(pool);
    console.log(`📋 Found ${appliedMigrations.length} applied migration(s)\n`);

    if (appliedMigrations.length === 0) {
      console.log('✅ No migrations to check');
      await pool.end();
      return;
    }

    const issues = [];
    let checked = 0;
    const migrationsDir = path.resolve('migrations');

    // Build combined list of all known migrations
    const appliedFilenames = new Set(appliedMigrations.map((m) => m.filename));
    const onDiskFiles = fs.existsSync(migrationsDir)
      ? fs
          .readdirSync(migrationsDir)
          .filter((f) => f.endsWith('.sql'))
          .sort()
      : [];
    const allKnownMigrations = [
      ...appliedMigrations,
      ...onDiskFiles.filter((f) => !appliedFilenames.has(f)).map((f) => ({ filename: f })),
    ].sort((a, b) => a.filename.localeCompare(b.filename));

    for (const migrationRecord of appliedMigrations) {
      const { filename, checksum: storedChecksum, applied_at } = migrationRecord;

      const migrationPath = path.join(migrationsDir, filename);
      if (!fs.existsSync(migrationPath)) {
        issues.push({
          migration: filename,
          issue: 'Migration file not found',
          severity: 'warning',
        });
        continue;
      }

      checked++;

      // Verify checksum
      const fileChecksum = calculateChecksum(migrationPath);
      if (storedChecksum && fileChecksum !== storedChecksum) {
        issues.push({
          migration: filename,
          issue: `Checksum mismatch (stored: ${storedChecksum.substring(0, 16)}..., file: ${fileChecksum.substring(0, 16)}...)`,
          severity: 'warning',
          fileChecksum,
        });
      }

      // Extract and verify schema changes
      const expectedChanges = extractExpectedSchemaChanges(migrationPath);

      const hasRealChanges =
        expectedChanges.columns.length > 0 ||
        expectedChanges.indexes.length > 0 ||
        expectedChanges.tables.length > 0;

      if (hasRealChanges) {
        const missingItems = await verifySchemaChanges(
          pool,
          expectedChanges,
          filename,
          allKnownMigrations,
        );
        if (missingItems.length > 0) {
          issues.push({
            migration: filename,
            issue: `Missing schema changes: ${missingItems.map((m) => `${m.type} ${m.name}`).join(', ')}`,
            severity: 'error',
            applied_at,
          });
        }
      }
    }

    console.log(`✅ Checked ${checked} migration(s)\n`);

    // Schema fingerprint tracking
    try {
      const fingerprintResult = await pool.query(
        "SELECT md5(string_agg(table_name || '.' || column_name || '.' || data_type || '.' || COALESCE(column_default, 'NULL'), '|' ORDER BY table_name, ordinal_position)) FROM information_schema.columns WHERE table_schema = 'public'",
      );
      const currentFingerprint = fingerprintResult.rows[0]?.md5 || 'unknown';

      const countResult = await pool.query(
        "SELECT COUNT(*) AS cnt FROM information_schema.columns WHERE table_schema = 'public'",
      );
      const columnCount = countResult.rows[0]?.cnt || '0';

      console.log(`📊 Schema fingerprint: ${currentFingerprint}`);
      console.log(`📊 Total public columns: ${columnCount}`);

      // Compare to last saved fingerprint
      const fingerprintFile = path.resolve('logs', 'schema-fingerprint.json');
      let driftDetected = false;
      if (fs.existsSync(fingerprintFile)) {
        try {
          const saved = JSON.parse(fs.readFileSync(fingerprintFile, 'utf8'));
          if (saved.production) {
            const prev = saved.production;
            if (prev.fingerprint !== currentFingerprint) {
              console.log('⚠️  SCHEMA FINGERPRINT CHANGED since last health check!');
              console.log(`   Previous: ${prev.fingerprint} (${prev.timestamp})`);
              console.log(`   Current:  ${currentFingerprint}`);
              console.log(`   Column count: ${prev.column_count} → ${columnCount}`);
              driftDetected = true;
              issues.push({
                migration: '(schema fingerprint)',
                issue: `Schema fingerprint changed: ${prev.fingerprint.substring(0, 12)}... → ${currentFingerprint.substring(0, 12)}... (columns: ${prev.column_count} → ${columnCount})`,
                severity: 'warning',
              });
            }
          }
        } catch {
          // Ignore parse errors
        }
      }

      // Save current fingerprint
      let fingerprintData = {};
      if (fs.existsSync(fingerprintFile)) {
        try {
          fingerprintData = JSON.parse(fs.readFileSync(fingerprintFile, 'utf8'));
        } catch {
          fingerprintData = {};
        }
      }
      fingerprintData.production = {
        fingerprint: currentFingerprint,
        column_count: columnCount,
        migration_count: appliedMigrations.length,
        timestamp: new Date().toISOString(),
      };
      const fingerprintDir = path.dirname(fingerprintFile);
      if (!fs.existsSync(fingerprintDir)) {
        fs.mkdirSync(fingerprintDir, { recursive: true });
      }
      fs.writeFileSync(fingerprintFile, `${JSON.stringify(fingerprintData, null, 2)}\n`);

      if (!driftDetected) {
        console.log('📊 Schema fingerprint: ✅ unchanged since last check');
      }
    } catch (fpError) {
      console.warn(`⚠️  Schema fingerprint check failed: ${fpError.message}`);
    }
    console.log('');

    if (issues.length === 0) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('✅ All migrations are healthy!');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    } else {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`⚠️  Found ${issues.length} issue(s):\n`);

      const errors = issues.filter((i) => i.severity === 'error');
      const warnings = issues.filter((i) => i.severity === 'warning');

      if (errors.length > 0) {
        console.log('❌ Errors:');
        for (const issue of errors) {
          console.log(`   • ${issue.migration}`);
          console.log(`     ${issue.issue}`);
          if (issue.applied_at) {
            console.log(`     Applied: ${issue.applied_at}`);
          }
          console.log('');
        }
      }

      if (warnings.length > 0) {
        console.log('⚠️  Warnings:');
        for (const issue of warnings) {
          console.log(`   • ${issue.migration}`);
          console.log(`     ${issue.issue}`);
          console.log('');
        }
      }

      // Generate SQL commands for checksum updates
      const checksumWarnings = warnings.filter((i) => i.fileChecksum);
      if (checksumWarnings.length > 0) {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📝 SQL Commands to Update Checksums:\n');
        for (const issue of checksumWarnings) {
          console.log(
            `UPDATE migrations SET checksum = '${issue.fileChecksum}' WHERE filename = '${issue.migration}';`,
          );
        }
        console.log('');
      }

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('\n💡 Recommendations:');
      console.log('   1. Review the migration files and database schema');
      console.log('   2. If schema changes are missing, re-run the migration');
      console.log('   3. For checksum mismatches: investigate git history');

      if (errors.length > 0) {
        process.exit(1);
      }
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
