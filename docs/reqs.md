# YapBay API Project Requirements

## Project Overview

YapBay is a peer-to-peer cryptocurrency trading platform that facilitates secure exchanges between crypto and fiat currencies. The platform utilizes blockchain-based smart contracts for escrow services, ensuring secure and trustless transactions. YapBay supports both single-leg trades (simple crypto-to-fiat exchanges) and sequential trades (multi-leg transactions that enable fiat-to-fiat exchanges through crypto as an intermediary).

## System Architecture

The YapBay platform consists of the following key components:

1. **Smart Contract Layer**: Ethereum/Celo-based escrow contracts that handle the secure holding and release of cryptocurrency funds.
2. **Database Layer**: PostgreSQL database that stores user accounts, trade information, and dispute records.
3. **API Layer**: Node.js/Express backend that connects the blockchain and database layers, providing endpoints for client applications.
4. **Client Applications**: Web and mobile interfaces that interact with the API (not covered in this document).

## Key Components

### 1. Smart Contract System

The `YapBayEscrow` smart contract provides the following core functionality:

- Creation of escrow agreements between buyers and sellers
- Deposit of funds into escrow
- Confirmation of fiat payment
- Release of funds to the buyer
- Cancellation of escrow when conditions are not met
- Dispute initiation and resolution process
- Support for sequential escrows (linked trades)

Key contract functions include:
- `createEscrow`: Initializes a new escrow agreement
- `fundEscrow`: Deposits cryptocurrency into the escrow
- `markFiatPaid`: Confirms fiat payment has been made
- `releaseEscrow`: Releases funds to the buyer
- `cancelEscrow`: Cancels the escrow and returns funds to the seller
- `openDisputeWithBond`: Initiates a dispute with a bond requirement
- `respondToDisputeWithBond`: Responds to a dispute with evidence
- `resolveDisputeWithExplanation`: Resolves a dispute with arbitrator decision

### 2. Database System

The database schema includes the following main tables:

- `accounts`: User profiles and wallet information
- `offers`: Buy/sell offers for crypto-fiat trades
- `trades`: Records of trades with leg1 and optional leg2 details
- `escrows`: On-chain escrow state tracking
- `disputes`: Dispute lifecycle tracking
- `dispute_evidence`: Evidence metadata storage
- `dispute_resolutions`: Arbitration outcomes

### 3. API Layer

The API will provide endpoints for:
- User account management
- Offer creation and management
- Trade initiation and monitoring
- Escrow operations
- Dispute handling
- Blockchain interaction

## Functional Requirements

### User Management

1. User registration and authentication
2. Profile management including contact details and availability
3. Wallet address association and verification

### Offer Management

1. Creation of buy/sell offers for crypto-fiat exchanges
2. Setting trade parameters (min/max amounts, rate adjustments, time limits)
3. Offer discovery and filtering

### Trade Execution

1. Initiation of trades based on offers
2. Support for single-leg trades (crypto-to-fiat)
3. Support for sequential trades (fiat-to-fiat via crypto)
4. Trade status tracking and notifications

### Escrow Management

1. Creation of escrow contracts on the blockchain
2. Monitoring of escrow states and deadlines
3. Handling of escrow events (funding, fiat payment, release, cancellation)
4. Integration with the smart contract for escrow operations

### Dispute Resolution

1. Initiation of disputes with evidence submission
2. Response to disputes with counter-evidence
3. Arbitration process and decision recording
4. Enforcement of dispute outcomes on the blockchain

## Technical Requirements

### Blockchain Integration

1. Connection to Celo blockchain network
2. Transaction creation and signing
3. Event monitoring and processing
4. Gas fee management

### Database Operations

1. CRUD operations for all database entities
2. Transaction management for data consistency
3. Efficient querying for performance
4. Data validation and integrity checks

### API Design

1. RESTful API endpoints for all operations
2. Authentication and authorization middleware
3. Input validation and error handling
4. Rate limiting and security measures

### Monitoring and Logging

1. Transaction logging for audit trails
2. Error tracking and reporting
3. Performance monitoring
4. System health checks

## API Endpoints (Preliminary)

### Account Endpoints
- `POST /api/accounts` - Create a new account
- `GET /api/accounts/:id` - Get account details
- `PUT /api/accounts/:id` - Update account information
- `GET /api/accounts/:id/trades` - Get account's trade history

### Offer Endpoints
- `POST /api/offers` - Create a new offer
- `GET /api/offers` - List available offers with filtering
- `GET /api/offers/:id` - Get offer details
- `PUT /api/offers/:id` - Update offer
- `DELETE /api/offers/:id` - Remove offer

### Trade Endpoints
- `POST /api/trades` - Create a new trade
- `GET /api/trades/:id` - Get trade details
- `PUT /api/trades/:id/fiat-paid` - Mark fiat as paid
- `PUT /api/trades/:id/cancel` - Cancel trade

### Escrow Endpoints
- `POST /api/escrows` - Create a new escrow
- `GET /api/escrows/:id` - Get escrow details
- `PUT /api/escrows/:id/fund` - Fund escrow
- `PUT /api/escrows/:id/release` - Release escrow
- `PUT /api/escrows/:id/cancel` - Cancel escrow

### Dispute Endpoints
- `POST /api/disputes` - Create a new dispute
- `GET /api/disputes/:id` - Get dispute details
- `POST /api/disputes/:id/evidence` - Submit dispute evidence
- `PUT /api/disputes/:id/resolve` - Resolve dispute

## Integration Points

### Blockchain Integration
- Integration with Celo blockchain for contract deployment and interaction
- Monitoring of blockchain events for escrow state changes
- Transaction signing and submission

### Payment System Integration
- Integration with fiat payment verification systems (optional)
- Support for multiple fiat currencies and payment methods

### Notification System
- Email notifications for trade status changes
- Push notifications for mobile clients
- In-app notifications for web clients

## Security Considerations

### Authentication and Authorization
- JWT-based authentication
- Role-based access control
- Secure password handling

### Blockchain Security
- Secure key management
- Transaction verification
- Smart contract auditing

### Data Protection
- Encryption of sensitive data
- GDPR compliance
- Privacy by design

### API Security
- Rate limiting
- Input validation
- HTTPS enforcement
- CORS configuration

## Development Roadmap

### Phase 1: Core Infrastructure
- Set up development environment
- Implement database schema
- Develop blockchain integration layer
- Create basic API structure

### Phase 2: Core Functionality
- Implement account management
- Develop offer creation and discovery
- Build trade execution flow
- Integrate escrow contract operations

### Phase 3: Dispute Resolution
- Implement dispute initiation
- Develop evidence submission system
- Create arbitration interface
- Integrate dispute resolution with blockchain

### Phase 4: Advanced Features
- Implement sequential trades
- Add support for additional cryptocurrencies
- Develop reputation system
- Create analytics dashboard

### Phase 5: Testing and Deployment
- Comprehensive testing (unit, integration, system)
- Security auditing
- Performance optimization
- Production deployment

## Constraints and Limitations

1. Maximum escrow amount is limited to 100 USDC per trade for security reasons
2. Dispute resolution requires bond deposits from both parties
3. Time limits for escrow operations are enforced by the smart contract
4. Sequential trades must be properly linked to ensure atomic execution

## Glossary

- **Escrow**: A financial arrangement where a third party holds and regulates payment of funds for two parties in a transaction
- **Leg**: A single part of a trade (leg1 = first transaction, leg2 = second transaction in a sequential trade)
- **Sequential Trade**: A trade that involves two linked escrows to facilitate fiat-to-fiat exchange
- **Dispute**: A formal disagreement between trade parties requiring arbitration
- **Bond**: A security deposit required to initiate or respond to a dispute
- **Arbitrator**: A trusted third party who resolves disputes between buyers and sellers
