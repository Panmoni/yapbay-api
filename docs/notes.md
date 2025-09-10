# YapBay API Notes

- clear db and start fresh
- remove divvi routes
- tests
- increment versions as appropriate

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

### Migrations

./scripts/migrate.js
