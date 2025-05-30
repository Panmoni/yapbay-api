# YapBay API Notes

## Referrals
Will need to record referrals, will need a table for that, route, migration... pending full integration of divvi into frontend

## refactor
1697 src/routes.ts
763 src/transactionRoutes.ts
659 src/listener/events.ts

## restart
clear db to start over

escrow monitoring service will keep throwing errors until I clear the db and start over

⚠️  WARNING: Using deprecated constructor. Use EscrowMonitoringService.createForNetwork() instead.


## Testing
update frontend, then create some new escrows, then npm run test:escrow-monitoring to test on both

test escrow backend monitoring service to see if it auto cancels and refunds for trades that have passed the timeout period. it will start when I start the api.

test the new balance api routes

test auto cancel recording in db

test divvi referral recording in db

get tests working again with a clean db.

## Ref
### Migrations
./scripts/migrate.js
