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

2. Enable pnpm via corepack (one-time per machine) and install dependencies:

```bash
corepack enable
pnpm install
```

The exact pnpm version is pinned in `package.json` via the `packageManager` field.

3. Set up environment variables:
   Create a `.env` file in the root directory with the following variables:

```
RPC_URL=
CONTRACT_ADDRESS=
ARBITRATOR_ADDRESS=
POSTGRES_URL=postgres://username:password@localhost:5432/yapbay
JWT_SECRET=your-jwt-secret
PRIVATE_KEY=your-private-key
PORT=3000
```

4. Set up the database:

```bash
psql -U your_username -d your_database -a -f schema.sql
```

5. Test the blockchain connection:

```bash
pnpm test:connection
```

6. Build the project:

```bash
pnpm build
```

7. Start the server:

```bash
# Start the server
npm start
```

For development:

```bash
pnpm start:dev
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

The API interacts with the YapBayEscrow smart contract. The contract handles:

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
pnpm test

# Run blockchain-related tests
pnpm test:blockchain

# Test blockchain connection
pnpm test:connection
````

### Linting

```bash
pnpm lint
```

### Claude Code Hooks

This repo ships with [Claude Code](https://docs.claude.com/en/docs/claude-code) hooks in [.claude/](.claude/) that add automated guardrails when working with the Claude Code CLI. The hooks are committed to git so anyone cloning the repo and running Claude Code in this directory gets the same safety nets automatically. Configuration lives in [.claude/settings.json](.claude/settings.json) and hook scripts in [.claude/hooks/](.claude/hooks/).

**What the hooks do:**

- **`block-dangerous.sh`** (PreToolUse on Bash) — blocks destructive commands before they run: `rm -rf`, `git reset --hard`, `git push --force`, `git clean -f`, `DROP TABLE/DATABASE`, unqualified `DELETE` / `TRUNCATE` on escrow/trade/account/transaction tables, `curl|sh`, `podman pod rm`, `podman prune`, `systemctl stop/disable/mask yapbay*`, `dd of=/dev/*`, `mkfs`, `chmod -R 777`. Exits with code 2 and sends Claude an explanation so it can propose a safer alternative.
- **`protect-files.sh`** (PreToolUse on Edit|Write) — blocks edits to `.env*`, `jwt.txt`, `jwt2.txt`, `*.pem`, `*.key`, `package-lock.json`, `yarn.lock`, `.npmrc`, `systemd/*.{service,socket,timer}`, `schema.sql`, `.git/*`, `secrets/*`. Migrations under [migrations/](migrations/) are treated as append-only: **new** migration files can be written, but **existing** ones cannot be edited in place.
- **`log-commands.sh`** (PreToolUse on Bash) — appends every Bash command Claude runs to `.claude/command-log.txt` with an ISO-8601 timestamp. The log is gitignored. Useful for post-hoc auditing if something unexpected happens during a session.
- **`post-edit-checks.sh`** (PostToolUse on Edit|Write) — after Claude edits any `.ts` / `.tsx` file, runs `eslint --fix` on the touched file and `tsc --noEmit` project-wide, tailing output to 20 lines each. Always exits 0 so diagnostics flow back to Claude as feedback rather than blocking the edit. This gives Claude a tight feedback loop: it sees lint/type errors immediately and fixes them before handing work back.

**What the hooks deliberately do *not* do:**

- No auto-running of `pnpm test` or `pnpm test:blockchain` — those tests require a live Postgres connection and hit Celo Alfajores RPC, making them too slow and flaky for per-edit execution. Run them manually before committing.
- No auto-commit on Stop. Commits are only created when explicitly requested.
- No Prettier invocation — the ESLint config already handles formatting fixes.

**Disabling or bypassing:** to run a command the hook would block (e.g. an intentional destructive operation), run it yourself in a normal shell outside of Claude. To disable the hooks entirely for a session, rename `.claude/settings.json` temporarily. To tweak the blocked patterns, edit the pattern arrays at the top of each script.

**Requirements:** the hooks rely on `jq` being on `PATH`. The post-edit checks call `npx --no-install`, so `eslint` and `typescript` must already be installed via `pnpm install`.

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
