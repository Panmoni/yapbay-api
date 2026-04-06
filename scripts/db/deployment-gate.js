#!/usr/bin/env node

/**
 * Deployment Gate — YapBay API
 *
 * Pre-deployment checks to ensure the system is ready for deployment.
 * Runs critical validations before allowing deployment to proceed.
 *
 * Usage:
 *   node scripts/db/deployment-gate.js
 */

const { Pool } = require('pg');
const { execSync } = require('node:child_process');
const fs = require('node:fs');

// Load environment
if (fs.existsSync('.env.local')) {
  require('dotenv').config({ path: '.env.local' });
}
require('dotenv').config();

const URL_MASK_REGEX = /:[^:@]+@/;
const databaseUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;

async function checkDatabaseConnectivity(pool) {
  try {
    await pool.query('SELECT 1');
    return { passed: true };
  } catch (error) {
    return { passed: false, error: `Database connection failed: ${error.message}` };
  }
}

async function checkMigrationHealth(pool) {
  try {
    const tableCheck = await pool.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'migrations');",
    );

    if (!tableCheck.rows[0].exists) {
      return { passed: false, error: 'Migrations table does not exist' };
    }

    const appliedMigrations = await pool.query(
      'SELECT filename FROM migrations ORDER BY applied_at',
    );

    return { passed: true, appliedCount: appliedMigrations.rows.length };
  } catch (error) {
    return {
      passed: false,
      error: `Migration health check failed: ${error.message}`,
    };
  }
}

function checkEnvironmentVariables() {
  const requiredVars = [];
  const warnings = [];

  if (!(process.env.POSTGRES_URL || process.env.DATABASE_URL)) {
    requiredVars.push('POSTGRES_URL or DATABASE_URL');
  }

  if (!process.env.JWT_SECRET) {
    requiredVars.push('JWT_SECRET');
  }

  if (!process.env.NODE_ENV) {
    warnings.push('NODE_ENV is not set (defaults to development)');
  }

  return { passed: requiredVars.length === 0, missing: requiredVars, warnings };
}

function checkMigrationHealthScript() {
  try {
    execSync('node scripts/db/migration-health-check.js', {
      stdio: 'pipe',
      timeout: 30_000,
    });
    return { passed: true };
  } catch {
    return {
      passed: false,
      warning: true,
      error: 'Migration health check script failed (see output above)',
    };
  }
}

function runCheck(name, checkResult, allPassedRef) {
  if (checkResult.passed) {
    console.log(`✅ ${name} check passed`);
    if (checkResult.warnings) {
      for (const warning of checkResult.warnings) {
        console.warn(`   ⚠️  ${warning}`);
      }
    }
    if (checkResult.appliedCount !== undefined) {
      console.log(`   (${checkResult.appliedCount} migrations applied)`);
    }
    return true;
  }
  if (checkResult.warning) {
    console.warn(`⚠️  ${checkResult.error}`);
    console.warn('   This is a warning - deployment can proceed but review migration health');
    return true;
  }
  console.error(
    `❌ ${checkResult.error || `Missing required: ${checkResult.missing?.join(', ')}`}`,
  );
  allPassedRef.current = false;
  return false;
}

async function main() {
  if (!databaseUrl) {
    console.error('❌ Missing POSTGRES_URL or DATABASE_URL environment variable');
    process.exit(1);
  }

  console.log('🚪 Deployment Gate — YapBay API\n');
  console.log(`📊 Database URL: ${databaseUrl.replace(URL_MASK_REGEX, ':****@')}\n`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const pool = new Pool({ connectionString: databaseUrl });
  const allPassedRef = { current: true };

  try {
    // Check 1: Environment variables
    console.log('🔍 Checking environment variables...');
    const envCheck = checkEnvironmentVariables();
    runCheck('Environment variables', envCheck, allPassedRef);
    console.log('');

    // Check 2: Database connectivity
    console.log('🔍 Checking database connectivity...');
    const dbCheck = await checkDatabaseConnectivity(pool);
    runCheck('Database connectivity', dbCheck, allPassedRef);
    console.log('');

    // Check 3: Migration health
    console.log('🔍 Checking migration health...');
    const migrationCheck = await checkMigrationHealth(pool);
    runCheck('Migration health', migrationCheck, allPassedRef);
    console.log('');

    // Check 4: Run detailed migration health check script
    console.log('🔍 Running detailed migration health check...');
    const healthScriptCheck = checkMigrationHealthScript();
    runCheck('Migration health script', healthScriptCheck, allPassedRef);
    console.log('');

    // Summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    if (allPassedRef.current) {
      console.log('✅ All deployment checks passed!');
      console.log('🚀 System is ready for deployment');
    } else {
      console.log('❌ Deployment checks failed!');
      console.log('⚠️  Please fix the issues above before deploying');
      process.exit(1);
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } catch (error) {
    console.error(`❌ Deployment gate failed: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
