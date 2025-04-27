# YapBay API Notes

clear linting errors

## test transaction endpoints with a real JWT?

I've created a test script (test-transaction-endpoints.js) that you can run to verify the functionality. You'll need to:

Add a TEST_JWT_TOKEN to your .env file
Update the trade ID in the test script to a valid trade ID from your database
Run the script with node test-transaction-endpoints.js

## Refactor Routes

maybe use new middleware and services directories.

still got admin login in main routes

## Setup

<!-- tail -f api.log
tail -f events.log
psql -h localhost -U yapbay -d yapbay -->
