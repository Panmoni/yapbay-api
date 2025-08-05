# YapBay API

This is the backend API for YapBay, a peer-to-peer cryptocurrency trading platform that facilitates secure exchanges between crypto and fiat currencies. The platform utilizes blockchain-based smart contracts for escrow services, ensuring secure and trustless transactions.

The primary repo for this project is at [https://github.com/Panmoni/yapbay](https://github.com/Panmoni/yapbay).

## Project Documentation

For detailed project requirements and specifications, see [Project Requirements](docs/reqs.md).

## Overview

YapBay is a platform that supports both single-leg trades (simple crypto-to-fiat exchanges) and sequential trades (multi-leg transactions that enable fiat-to-fiat exchanges through crypto as an intermediary).

### System Architecture

The YapBay platform consists of the following key components:

1. **Smart Contract Layer**: Solana-based escrow contracts that handle the secure holding and release of cryptocurrency funds
2. **Database Layer**: PostgreSQL database that stores user accounts, trade information, and dispute records
3. **API Layer**: Node.js/Express backend that connects the blockchain and database layers
4. **Client Applications**: Web and mobile interfaces that interact with the API

### API Functionality

The YapBay API provides endpoints for:

- User account management
- Creating and managing offers
- Initiating and completing trades
- Escrow operations (create, fund, release, cancel)
- Dispute handling and resolution
- Interacting with the YapBayEscrow smart contract on Solana devnet

## Prerequisites

- Node.js (v18 or higher)
- PostgreSQL database
- Solana testnet account with USDC tokens
- Private key for a funded Solana account

## Setup

1. Clone the repository:

```bash
git clone https://github.com/Panmoni/yapbay-api.git
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
# Start the server
npm start
```

For development:

```bash
npm run start:dev
```

```

## API Endpoints

### Authentication

All authenticated endpoints require a JWT token in the Authorization header:
```

Authorization: Bearer your-jwt-token

````

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
- `GET /escrows/:trade_id` - Get escrow details by trade ID
- `GET /my/escrows` - Get authenticated user's escrows
- `POST /escrows/release` - Release an escrow
- `POST /escrows/cancel` - Cancel an escrow
- `POST /escrows/dispute` - Open a dispute

## Smart Contract Interaction

The API interacts with the YapBayEscrow smart contract deployed on the Celo Alfajores testnet using ethers.js. The contract handles:

- Creating escrows between buyers and sellers
- Funding escrows with USDC
- Marking fiat as paid
- Releasing funds to the buyer
- Cancelling escrows when conditions are not met
- Handling disputes with bond requirements
- Supporting sequential escrows (linked trades)

Key contract functions include:
- `createEscrow`: Initializes a new escrow agreement
- `fundEscrow`: Deposits cryptocurrency into the escrow
- `markFiatPaid`: Confirms fiat payment has been made
- `releaseEscrow`: Releases funds to the buyer
- `cancelEscrow`: Cancels the escrow and returns funds to the seller
- `openDisputeWithBond`: Initiates a dispute with a bond requirement
- `respondToDisputeWithBond`: Responds to a dispute with evidence
- `resolveDisputeWithExplanation`: Resolves a dispute with arbitrator decision

## Development

### Running Tests

```bash
# Run all tests
npm test

# Run blockchain-related tests
npm run test:blockchain

# Test blockchain connection
npm run test:connection
````

### Linting

```bash
npm run lint
```

## Security Considerations

- JWT-based authentication and authorization
- Secure blockchain key management
- Transaction verification
- Data encryption for sensitive information
- Rate limiting and input validation
- HTTPS enforcement

## Constraints and Limitations

1. Maximum escrow amount is limited to 100 USDC per trade for security reasons
2. Dispute resolution requires bond deposits from both parties
3. Time limits for escrow operations are enforced by the smart contract
4. Sequential trades must be properly linked to ensure atomic execution

## License

This project is licensed under the MIT License.
