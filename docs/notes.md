# YapBay API Notes


## restart

- clear db to start over
- escrow monitoring service will keep throwing errors until I clear the db and start over
- on start ⚠️ WARNING: Using deprecated constructor. Use EscrowMonitoringService.createForNetwork() instead.

## Tests

get tests working again with a clean db and the refactored routes/middleware

## Testing

- update frontend, then create some new escrows, then npm run test:escrow-monitoring to test on both
- test escrow backend monitoring service to see if it auto cancels and refunds for trades that have passed the timeout period. it will start when I start the api.
- test the new balance api routes
- test divvi referral recording in db
- test auto cancel recording in db
- test updating of legacy events with test-events script

## Refactor

659 src/listener/events.ts

## Ref

### Migrations

./scripts/migrate.js
