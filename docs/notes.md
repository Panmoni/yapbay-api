# YapBay API Notes

## Coordinate testing with frontend

- clear db, restart it
- is the event listener getting the events
- update frontend, then create some new escrows, then npm run test:escrow-monitoring to test on both
- test escrow backend monitoring service to see if it auto cancels and refunds for trades that have passed the timeout period. it will start when I start the api.
- test the new balance api routes
- test auto cancel recording in db
- test updating of legacy events with test-events script

## Backend Monitoring Service

to ensure funds not getting left in escrows

Priority 2: Deadline Processing Tests
Create src/tests/solanaDeadlineProcessing.test.ts to cover:
Database trigger enforcement for Solana trades
Auto-cancellation of expired Solana escrows
Network-specific deadline processing

consider how to more quickly recover from a listener that failed and recover past events, also give more thought to error handling with events

## Create a new api ref document

## Ref

### Clean DB Reset

DROP DATABASE IF EXISTS yapbay;
CREATE DATABASE yapbay;
GRANT ALL PRIVILEGES ON DATABASE yapbay TO yapbay;

-- Set schema permissions
\c yapbay
GRANT USAGE, CREATE ON SCHEMA public TO yapbay;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO yapbay;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO yapbay;
\q

psql postgres://yapbay:PASSWD@localhost:5432/yapbay -f schema.sql

#### check

-- Check all tables exist
\dt

-- Verify networks were inserted
SELECT name, chain_id, is_active FROM networks;

-- Check total table count (should be 13 tables)
SELECT count(\*) FROM information_schema.tables WHERE table_schema = 'public';

-- Check indexes were created
SELECT count(\*) FROM pg_indexes WHERE schemaname = 'public';

### Migrations

./scripts/migrate.js
