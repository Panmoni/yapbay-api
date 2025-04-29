# Database Migrations

This document explains how to use the database migration system for YapBay API.

## Migration Files

Migration files are stored in the `migrations/` directory and follow this naming convention:

```
YYYYMMDDHHMMSS_descriptive_name.sql
```

For example: `20250429180100_add_missing_columns.sql`

## Running Migrations

### Using the Migration Script

The migration script automates the process of applying migrations and tracking them in the database:

1. Install the required dependency:
   ```
   npm install pg
   ```

2. Make the script executable:
   ```
   chmod +x scripts/migrate.js
   ```

3. Run the migration script:
   ```
   node scripts/migrate.js
   ```

The script will:
- Check which migrations have already been applied
- Apply any pending migrations in order
- Record each migration in the `schema_migrations` table
- Handle errors and mark migrations as "dirty" if they fail

### Manual Migration

If you prefer to run migrations manually:

1. Apply the migration:
   ```
   psql -h localhost -U yapbay -d yapbay -f migrations/YYYYMMDDHHMMSS_name.sql
   ```

2. Record the migration in the database:
   ```sql
   INSERT INTO schema_migrations (version, description, dirty)
   VALUES ('YYYYMMDDHHMMSS', 'Description of migration', FALSE);
   ```

## Creating New Migrations

1. Create a new SQL file in the `migrations/` directory with a timestamp prefix:
   ```
   YYYYMMDDHHMMSS_descriptive_name.sql
   ```

2. Write your SQL statements in the file.

3. Run the migration using the script or manually.

## Schema Migrations Table

The `schema_migrations` table tracks which migrations have been applied:

```sql
CREATE TABLE schema_migrations (
  version VARCHAR(255) NOT NULL PRIMARY KEY,
  applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  description TEXT,
  dirty BOOLEAN NOT NULL DEFAULT FALSE
);
```

- `version`: Unique identifier for the migration (timestamp)
- `applied_at`: When the migration was applied
- `description`: Human-readable description of what the migration does
- `dirty`: Flag indicating if a migration failed during application

## Best Practices

1. Always use the timestamp naming convention for migration files
2. Make migrations idempotent when possible (can be run multiple times without error)
3. Use `IF NOT EXISTS` and `IF EXISTS` clauses for safety
4. Keep migrations small and focused on a single change
5. Include both "up" (apply) and "down" (rollback) logic when possible
6. Test migrations in a development environment before applying to production
