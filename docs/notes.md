# YapBay API Notes

update routes for multi-network

## api contracts
enable these to be pulled from the api so can be shown on app. maybe return them as part of /health?

select * from networks

## Referrals
Will need to record referrals, will need a table for that, route, migration... pending full integration of divvi into frontend

## refactor
1639 src/routes.ts
759 src/transactionRoutes.ts

one command to start api, listener, backend monitoring service

## restart
clear db to start over

## Testing
update frontend, then create some new escrows, then npm run test:escrow-monitoring to test on both

test escrow backend monitoring service to see if it auto cancels and refunds for trades that have passed the timeout period. it will start when I start the api.

test the new balance api routes

test auto cancel recording in db

test divvi referral recording in db

## Ref
### Migrations
./scripts/migrate.js
