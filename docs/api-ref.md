# API REF

## Health
curl http://localhost:3011/health/ -H "Content-Type: application/json" -H "Authorization: Bearer $(cat jwt.txt)"
## Accounts
### Fetch Account
curl http://localhost:3011/accounts/me -H "Authorization: Bearer $(cat jwt.txt)"
### Create Account
curl -X POST http://localhost:3011/accounts \
-H "Content-Type: application/json" \
-H "Authorization: Bearer $(cat jwt.txt)" \
-d '{
  "wallet_address": "0xDD304336Cf878dF7d2647435D5f57C2345B140C1",
  "username": "george",
  "email": "george.donnelly+yapbay@gmail.com"
}'
## Offers
### Create Offer
curl -X POST http://localhost:3011/offers \
-H "Content-Type: application/json" \
-H "Authorization: Bearer $(cat jwt.txt)" \
-d '{
  "creator_account_id": 1,
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
## Trades
### Create Trade
