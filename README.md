# YapBay API

This is the backend API for YapBay, a peer-to-peer trading platform built on the Celo blockchain.

## Overview

The YapBay API provides endpoints for:
- User account management
- Creating and managing offers
- Initiating and completing trades
- Interacting with the YapBayEscrow smart contract on Celo Alfajores testnet

## Prerequisites

- Node.js (v18 or higher)
- PostgreSQL database
- Celo Alfajores testnet account with USDC tokens

## Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/yapbay-api.git
cd yapbay-api
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
Create a `.env` file in the root directory with the following variables:
```
CELO_RPC_URL=https://alfajores-forno.celo-testnet.org
CONTRACT_ADDRESS=0xC8BFB8a31fFbAF5c85bD97a1728aC43418B5871C
ARBITRATOR_ADDRESS=0x6d2dAaA22a90AC8721D1f9C207D817AB7C490383
POSTGRES_URL=postgres://username:password@localhost:5432/yapbay
JWT_SECRET=your-jwt-secret
PRIVATE_KEY=your-private-key
PORT=3000
```

4. Set up the database:
```bash
psql -U your_username -d your_database -a -f schema.sql
```

5. Test the Celo connection:
```bash
npm run test:connection
```

6. Build the project:
```bash
npm run build
```

7. Start the server:
```bash
# Start with Solana (original)
npm start

# Start with Celo
npm run start:celo
```

For development:
```bash
npm run start:dev
```

## API Endpoints

### Authentication

All authenticated endpoints require a JWT token in the Authorization header:
```
Authorization: Bearer your-jwt-token
```

### Accounts

- `POST /accounts` - Create a new account
- `GET /accounts/me` - Get authenticated user's account
- `GET /accounts/:id` - Get account by ID
- `PUT /accounts/:id` - Update account

### Offers

- `POST /offers` - Create a new offer
- `GET /offers` - List offers (with optional filters)
- `GET /offers/:id` - Get offer details
- `PUT /offers/:id` - Update an offer
- `DELETE /offers/:id` - Delete an offer

### Trades

- `POST /trades` - Initiate a trade
- `GET /trades` - List trades (with optional filters)
- `GET /my/trades` - List authenticated user's trades
- `GET /trades/:id` - Get trade details
- `PUT /trades/:id` - Update trade info

### Escrows

- `POST /escrows/create` - Create a new escrow
- `POST /escrows/fund` - Fund an escrow
- `POST /escrows/mark-fiat-paid` - Mark fiat as paid
- `POST /escrows/release` - Release an escrow
- `POST /escrows/cancel` - Cancel an escrow
- `POST /escrows/dispute` - Open a dispute
- `GET /escrows/:id` - Get escrow details
- `GET /escrows/trade/:trade_id` - Get escrows for a trade
- `GET /my/escrows` - Get authenticated user's escrows

## Smart Contract Interaction

The API interacts with the YapBayEscrow smart contract deployed on the Celo Alfajores testnet. The contract handles:

- Creating escrows
- Funding escrows with USDC
- Marking fiat as paid
- Releasing funds to the buyer
- Cancelling escrows
- Handling disputes

## Development

### Running Tests

```bash
# Run all tests
npm test

# Run only Celo-related tests
npm run test:celo

# Test Celo connection
npm run test:connection
```

### Linting

```bash
npm run lint
```

## License

This project is licensed under the ISC License.