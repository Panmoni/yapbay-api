# API REF

## Pending Tests
- escrow accounts: create, fund, release
- dispute actions
- trade updates

### Update Trade State

## Users
User 1 0xDD304336Cf878dF7d2647435D5f57C2345B140C1
User 2 0x14140b0dbC4736124ea9F5230D851f62F99b0ac5
## Health
curl http://localhost:3011/health/ -H "Content-Type: application/json" -H "Authorization: Bearer $(cat jwt.txt)"
## Prices
curl http://localhost:3011/prices
## Accounts
### Fetch Account
curl http://localhost:3011/accounts/me -H "Authorization: Bearer $(cat jwt.txt)"

curl http://localhost:3011/accounts/2 -H "Authorization: Bearer $(cat jwt.txt)" | jq '.'
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
curl -X PUT http://localhost:3011/accounts/1 \
-H "Content-Type: application/json" \
-H "Authorization: Bearer $(cat jwt.txt)" \
-d '{
  "telegram_username": "yapbay_user1"
}' | jq '.'
## Offers
### Create Offer
curl -X POST http://localhost:3011/offers \
-H "Content-Type: application/json" \
-H "Authorization: Bearer $(cat jwt.txt)" \
-d '{
  "creator_account_id": 1,
  "offer_type": "BUY",
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
curl "http://localhost:3011/offers?owner=me" -H "Authorization: Bearer $(cat jwt.txt)" | jq '.'
### Get Offers by Type
curl "http://localhost:3011/offers?type=SELL" -H "Authorization: Bearer $(cat jwt.txt)" | jq '.'
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
### Record Escrow
curl -X POST http://localhost:3011/escrows/record \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(cat jwt.txt)" \
  -d '{ 
    "trade_id": 123, 
    "transaction_hash": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef", 
    "escrow_id": "1234567890123456789012345678901234567890123456789012345678901234", 
    "seller": "0xYourWalletAddressHere", 
    "buyer": "0x1234567890123456789012345678901234567890", 
    "amount": 100, 
    "sequential": false 
  }'
### Release Escrow
### Fund Escrow
## Disputes