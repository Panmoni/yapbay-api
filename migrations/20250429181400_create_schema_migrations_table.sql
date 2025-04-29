-- Migration: Create schema_migrations table
-- Date: 2025-04-29 18:14:00

-- Create the schema_migrations table if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'schema_migrations'
    ) THEN
        CREATE TABLE schema_migrations (
            version VARCHAR(255) NOT NULL PRIMARY KEY,
            applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
            description TEXT,
            dirty BOOLEAN NOT NULL DEFAULT FALSE
        );
        
        RAISE NOTICE 'Created schema_migrations table';
    ELSE
        RAISE NOTICE 'schema_migrations table already exists';
    END IF;
END $$;
