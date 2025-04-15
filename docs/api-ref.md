# API REF

User 1 0xDD304336Cf878dF7d2647435D5f57C2345B140C1
User 2 0x14140b0dbC4736124ea9F5230D851f62F99b0ac5

## Health
curl http://localhost:3011/health/ -H "Content-Type: application/json" -H "Authorization: Bearer $(cat jwt.txt)"
## Prices


## Accounts
### Fetch Account
curl http://localhost:3011/accounts/me -H "Authorization: Bearer $(cat jwt.txt)"
### Create Account
curl -X POST http://localhost:3011/accounts \
-H "Content-Type: application/json" \
-H "Authorization: Bearer $(cat jwt2.txt)" \
-d '{
  "wallet_address": "0x14140b0dbC4736124ea9F5230D851f62F99b0ac5",
  "username": "gsd",
  "email": "george.donnelly+yapbay2@gmail.com"
}'
### Fetch Specific Account Details
### Update Account
## Offers
### Create Offer
curl -X POST http://localhost:3011/offers \
-H "Content-Type: application/json" \
-H "Authorization: Bearer $(cat jwt2.txt)" \
-d '{
  "creator_account_id": 2,
  "offer_type": "SELL",
  "token": "USDC",
  "fiat_currency": "USD",
  "min_amount": 10
}'
### List offers
curl http://localhost:3011/offers -H "Authorization: Bearer $(cat jwt.txt)" | jq '.'
### Get Offer Details
curl http://localhost:3011/offers/1 -H "Authorization: Bearer $(cat jwt.txt)" | jq '.'
### Update Offer
curl -X PUT http://localhost:3011/offers/1 \
-H "Content-Type: application/json" \
-H "Authorization: Bearer $(cat jwt.txt)" \
-d '{
  "min_amount": 15
}' | jq '.'
### Delete Offer
curl -X DELETE http://localhost:3011/offers/1 -H "Authorization: Bearer $(cat jwt.txt)" | jq '.'
### Offer Filtering


## Trades
### Create Trade
curl -X POST http://localhost:3011/trades \
-H "Content-Type: application/json" \
-H "Authorization: Bearer $(cat jwt.txt)" \
-d '{
"leg1_offer_id": 3,
"leg1_crypto_amount": 20,
"from_fiat_currency": "USD"
}' | jq '.'
### List My Trades
curl http://localhost:3011/my/trades -H "Authorization: Bearer $(cat jwt.txt)" | jq '.'
### List All Trades
curl http://localhost:3011/trades -H "Authorization: Bearer $(cat jwt.txt)" | jq '.'
### Filter Trades
### Get Trade Details
curl http://localhost:3011/trades/1 -H "Authorization: Bearer $(cat jwt.txt)" | jq '.'
### Mark Fiat Paid
curl -X PUT http://localhost:3011/trades/1 \
-H "Content-Type: application/json" \
-H "Authorization: Bearer $(cat jwt.txt)" \
-d '{
  "fiat_paid": true
}' | jq '.'
## Escrows
### Create Escrow
### Release Escrow
### Fund Escrow
## Disputes