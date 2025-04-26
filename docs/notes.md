# YapBay API Notes

## auto cancel

must not happen if mark fiat is paid

if the escrow is funded but mrk fiat paid fails, can't cancel if it has a balance

cancel trade on-chain?

## record all txs

Need a route to record follow on transactions

## Refactor Routes

maybe use new middleware and services directories.

still got admin login in main routes

## Setup

<!-- tail -f api.log
tail -f events.log
psql -h localhost -U yapbay -d yapbay -->
