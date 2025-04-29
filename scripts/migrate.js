#!/usr/bin/env node

/**
 * Simple database migration script for YapBay API
 * 
 * This script:
 * 1. Checks for migrations in the migrations/ directory
 * 2. Determines which migrations have not been applied yet
 * 3. Applies pending migrations in order
 * 4. Records each migration in the schema_migrations table
 * 
 * Usage: node scripts/migrate.js [--only=filename.sql]
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const { Client } = require('pg');
require('dotenv').config();

const execPromise = promisify(exec);

// Parse command line arguments
const args = process.argv.slice(2);
let onlyFile = null;

args.forEach(arg => {
  if (arg.startsWith('--only=')) {
    onlyFile = arg.split('=')[1];
  }
});

// Get database connection string from environment
const dbConnectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

if (!dbConnectionString) {
  console.error('Error: No database connection string found in environment variables');
  console.error('Please set POSTGRES_URL or DATABASE_URL in your .env file');
  process.exit(1);
}

// Connect to the database
const client = new Client({
  connectionString: dbConnectionString
});

// Path to migrations directory
const migrationsDir = path.join(__dirname, '..', 'migrations');

// Ensure migrations directory exists
if (!fs.existsSync(migrationsDir)) {
  console.error(`Error: Migrations directory not found at ${migrationsDir}`);
  process.exit(1);
}

// Main migration function
async function migrate() {
  try {
    await client.connect();
    console.log('Connected to database');

    // Ensure schema_migrations table exists
    await ensureMigrationsTable();

    // Get list of applied migrations
    const appliedMigrations = await getAppliedMigrations();
    console.log(`Found ${appliedMigrations.length} previously applied migrations`);

    // Get list of all migration files
    let migrationFiles = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort(); // Sort to ensure migrations are applied in order

    // If --only flag is provided, filter to only that file
    if (onlyFile) {
      migrationFiles = migrationFiles.filter(file => file === onlyFile);
      if (migrationFiles.length === 0) {
        console.error(`Error: Migration file ${onlyFile} not found in ${migrationsDir}`);
        process.exit(1);
      }
      console.log(`Only applying migration: ${onlyFile}`);
    } else {
      console.log(`Found ${migrationFiles.length} migration files`);
    }

    // Determine which migrations need to be applied
    const pendingMigrations = migrationFiles.filter(file => {
      const version = getMigrationVersion(file);
      return !appliedMigrations.includes(version);
    });

    if (pendingMigrations.length === 0) {
      console.log('No pending migrations to apply');
      await client.end();
      return;
    }

    console.log(`Applying ${pendingMigrations.length} pending migrations...`);

    // Apply each pending migration
    for (const migrationFile of pendingMigrations) {
      const version = getMigrationVersion(migrationFile);
      const migrationPath = path.join(migrationsDir, migrationFile);
      
      console.log(`Applying migration: ${migrationFile}`);
      
      try {
        // Mark migration as started (dirty=true)
        await markMigrationStarted(version, getDescriptionFromFilename(migrationFile));
        
        // Apply the migration
        await applyMigration(migrationPath);
        
        // Mark migration as completed (dirty=false)
        await markMigrationCompleted(version);
        
        console.log(`✅ Successfully applied migration: ${migrationFile}`);
      } catch (error) {
        console.error(`❌ Error applying migration ${migrationFile}:`, error.message);
        console.error('Migration process aborted. Please fix the error and try again.');
        process.exit(1);
      }
    }

    console.log('All migrations applied successfully!');
  } catch (error) {
    console.error('Migration error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Ensure schema_migrations table exists
async function ensureMigrationsTable() {
  try {
    // Check if table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'schema_migrations'
      );
    `);
    
    if (!tableCheck.rows[0].exists) {
      console.log('Creating schema_migrations table...');
      await client.query(`
        CREATE TABLE schema_migrations (
          version VARCHAR(255) NOT NULL PRIMARY KEY,
          applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
          description TEXT,
          dirty BOOLEAN NOT NULL DEFAULT FALSE
        );
      `);
      console.log('Created schema_migrations table');
    }
  } catch (error) {
    console.error('Error ensuring migrations table exists:', error.message);
    throw error;
  }
}

// Get list of already applied migrations
async function getAppliedMigrations() {
  try {
    const result = await client.query('SELECT version FROM schema_migrations ORDER BY version');
    return result.rows.map(row => row.version);
  } catch (error) {
    if (error.code === '42P01') { // Table does not exist
      return [];
    }
    throw error;
  }
}

// Apply a migration file
async function applyMigration(migrationPath) {
  try {
    const command = `psql "${dbConnectionString}" -f "${migrationPath}"`;
    const { stdout, stderr } = await execPromise(command);
    
    if (stderr && !stderr.includes('NOTICE:') && !stderr.includes('psql:')) {
      throw new Error(stderr);
    }
    
    return stdout;
  } catch (error) {
    throw new Error(`Failed to apply migration: ${error.message}`);
  }
}

// Mark a migration as started (dirty=true)
async function markMigrationStarted(version, description) {
  await client.query(
    'INSERT INTO schema_migrations (version, description, dirty) VALUES ($1, $2, TRUE)',
    [version, description]
  );
}

// Mark a migration as completed (dirty=false)
async function markMigrationCompleted(version) {
  await client.query(
    'UPDATE schema_migrations SET dirty = FALSE WHERE version = $1',
    [version]
  );
}

// Extract version from migration filename (e.g., 20250429180100_add_missing_columns.sql -> 20250429180100)
function getMigrationVersion(filename) {
  const match = filename.match(/^(\d+)_/);
  return match ? match[1] : filename.split('_')[0];
}

// Extract description from migration filename (e.g., 20250429180100_add_missing_columns.sql -> add missing columns)
function getDescriptionFromFilename(filename) {
  // Remove version prefix and .sql extension, replace underscores with spaces
  return filename
    .replace(/^\d+_/, '')
    .replace(/\.sql$/, '')
    .replace(/_/g, ' ');
}

// Run the migration
migrate().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
