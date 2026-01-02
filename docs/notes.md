# YapBay API Notes

23 lint problems
0 build

## Frontend x Listener

might be doing some double duty and getting in the way of each other.

Also many skipped ids in transactions table

## Backend Monitoring Service

to ensure funds not getting left in escrows

- test escrow backend monitoring service to see if it auto cancels and refunds for trades that have passed the timeout period. it will start when I start the api.
- test auto cancel recording in db
- npm run test:escrow-monitoring to

### deadline processing tests

- Create src/tests/solanaDeadlineProcessing.test.ts to cover:
  - Database trigger enforcement for Solana trades
  - Auto-cancellation of expired Solana escrows
  - Network-specific deadline processing

### balance monitoring

- Create Solana-specific balance querying methods in SolanaService
- Add network family detection to route handlers to use appropriate service
- Add comprehensive tests for Solana balance endpoints
- Implement Solana escrow balance logic using Solana program interactions
- should balances be updated in the db based on escrow balance change events?

### listener event failure

- consider how to more quickly recover from a listener that failed and recover past events, also give more thought to error handling with events

## Enhance frontend api/index.ts

docs/api.ts is an ideal approach
docs/current-api.ts is a middle ground for now, may need further changes, which will come from the frontend likely

Add proper error handling with custom error types - Replace generic Axios errors with typed API errors for better debugging and user experience
Add response type wrappers - Wrap all responses in consistent ApiResponse<T> format to match backend API structure
Add network validation - Validate network IDs and provide helpful error messages for invalid networks
Medium Priority (Developer Experience)
Add request/response logging - Add optional debug logging for API calls to help with development and troubleshooting
Add retry logic for failed requests - Implement automatic retry for network failures and 5xx errors to improve reliability
Add request timeout configuration - Add configurable timeouts to prevent hanging requests and improve UX
Low Priority (Performance & Polish)
Add request cancellation support - Add AbortController support to cancel in-flight requests when components unmount
Add response caching - Add simple in-memory caching for GET requests to reduce API calls and improve performance
Add TypeScript strict mode compliance - Fix any remaining TypeScript issues and add strict type checking
Add JSDoc documentation - Add comprehensive JSDoc comments to all functions for better developer experience

## New API Ref Doc

comprensive doc, update README, etc

## Ref

### Deploy

- podman stop yapbay-api-server
- podman rm yapbay-api-server
- npm run deploy

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

Get id from mathesar
SELECT \* FROM public.mathesar_database;

Delete
DELETE FROM public.mathesar_userdatabaserolemap WHERE database_id = 9;
DELETE FROM public.mathesar_database WHERE name = 'yapbay';

re-add to mathesar

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


### Helius RPC
https://dashboard.helius.dev/usage?projectId=13770995-96e0-4ee3-ad4b-4f8d61166fb8