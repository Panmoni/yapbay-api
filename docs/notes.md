# YapBay API Notes

lint, build

event listener, celo.ts and any other files? need to be updated for mainnet

how is scrow monitoring service checking balances?

update db for escrowbalancechanged event,

ensure schema.sql is up to date for recent migrations

## handle 2 networks
API needs to be able to distinguish between testnet and mainnet. What else needs updating to handle both networks? What about the schema?
ensure schema is up to date and add ability to track if data is for testnet or mainnet

## api contracts
enable these to be pulled from the api so can be shown on app.

## Referrals
Will need to record referrals, will need a table for that, route, migration... pending full integration of divvi into frontend

## restart
clear db to start over

## Testing
update frontend, then create some new escrows, then npm run test:escrow-monitoring to test on both

test escrow backend monitoring service to see if it auto cancels and refunds for trades that have passed the timeout period. it will start when I start the api.

test auto cancel recording in db

test divvi referral recording in db

test the new balance api routes

## Ref
### Migrations
./scripts/migrate.js
