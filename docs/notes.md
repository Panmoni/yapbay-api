# YapBay API Notes

- tests
- increment versions as appropriate once tests pass again

## Phase 4: Event Handling Microservice

- [ ] Design microservice architecture
- [ ] Implement blockchain event monitoring
- [ ] Create database synchronization logic
- [ ] Add error handling and retry mechanisms
- [ ] Test event processing and recovery

## backend monitoring service

to ensure funds not getting left in escrows

## Tests

get tests working again with a clean db and the refactored routes/middleware

- update frontend, then create some new escrows, then npm run test:escrow-monitoring to test on both
- test escrow backend monitoring service to see if it auto cancels and refunds for trades that have passed the timeout period. it will start when I start the api.
- test the new balance api routes
- test auto cancel recording in db
- test updating of legacy events with test-events script

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
