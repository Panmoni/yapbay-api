Use when the user needs to plan a feature, fix, refactor, migration, or integration before writing code. Builds a concrete, stress-tested implementation plan grounded in this codebase's architecture, constraints, and priorities. Does NOT write code — produces a plan the user approves before work begins. $ARGUMENTS

## Context

This is **yapbay-api** — a P2P trading platform with on-chain escrow (Solana + legacy Celo) handling trades, disputes, and settlement. The priority hierarchy is: **financial correctness > data integrity > security > reliability > developer experience**.

Stack: Node.js / Express / TypeScript / PostgreSQL. Deployed via Podman containers with systemd services. Git workflow: direct push to main (no PRs).

## Workflow

### Step 0: Understand the goal

Parse the user's input (`$ARGUMENTS` or conversation context) to identify:
- **What** they want to achieve (feature, fix, refactor, migration, integration, infrastructure change)
- **Why** it matters (business driver, incident response, tech debt, compliance requirement)
- **Scope** — which domains are touched (accounts, offers, trades, escrows, transactions, disputes, blockchain, auth, admin)

If the goal is vague, ask pointed questions before proceeding. Don't plan against assumptions.

### Step 1: Clarify the end state

Define "done" concretely:
- What observable behavior changes? (API responses, database state, blockchain interaction, event handling)
- What is the single most important acceptance criterion?
- Are there financial correctness implications? (double-processing risk, escrow balance discrepancies, lost funds)
- Does this touch money flow? If yes, every operation must be idempotent and safe to retry.

### Step 2: Map the codebase impact

Read relevant source files to ground the plan in reality. Use this map:

| Domain | Key files |
|--------|-----------|
| Accounts | `src/routes/accounts/` |
| Offers | `src/routes/offers/` |
| Trades | `src/routes/trades/` |
| Escrows | `src/routes/escrows/`, `src/services/escrowMonitoringService.ts` |
| Transactions | `src/routes/transactions/` |
| Disputes | `src/routes/disputes/` (if exists) |
| Blockchain (Solana) | `src/services/solanaService.ts`, `src/services/blockchainService.ts` |
| Blockchain (Celo) | `src/celo.ts` (legacy) |
| Events | `src/listener/`, `src/services/deadlineService.ts` |
| Networks | `src/services/networkService.ts` |
| Database | `src/db.ts`, `schema.sql`, `migrations/` |
| Auth/Middleware | `src/middleware/` |
| Admin | `src/routes/admin/` |
| Validation | `src/validation/` |
| Contracts | `src/contracts/solana/`, `src/contracts/evm/` |

**Always read `schema.sql`** if the plan involves database queries or schema changes. Never guess column names.

Check `docs/` for existing documentation on the domain.

### Step 3: Map constraints

Identify and state explicitly:
- **Non-negotiables** from the intent hierarchy (financial correctness, idempotency, escrow safety)
- **Schema constraints** — FK relationships, unique indexes, NOT NULL columns, enum types
- **Blockchain constraints** — Solana program interactions, transaction signing, network differences (devnet vs mainnet)
- **Deployment constraints** — Podman containers, systemd services, zero-downtime requirements
- **Migration constraints** — must be idempotent (`IF NOT EXISTS` / `IF EXISTS`), never edit applied migrations, `schema.sql` must stay in sync
- **What's already been tried or ruled out** (from conversation or user input)
- **Hook protections** — `.claude/hooks/` blocks edits to schema.sql, migrations (append-only), .env files

### Step 4: Identify the critical path

Break the work into **3-7 milestones** ordered by dependency:

For each milestone, specify:
- **What**: concrete deliverable (file changes, migration, config)
- **Depends on**: which prior milestones must be complete
- **Parallel?**: can this run alongside other milestones
- **Risk**: what could go wrong here specifically

Flag the **single biggest bottleneck or risk** explicitly.

### Step 5: Build the plan

For each milestone, list concrete actions:

```
Milestone N: [Title]
Depends on: [milestone numbers or "none"]
Files to create/modify:
  - path/to/file.ts — what changes
  - migrations/NNN-YYYY-MM-DD-description.sql — what it does
Actions:
  1. [verb] [object] [detail]
  2. ...
Test strategy:
  - Which test files to run/create
Risk:
  - What could go wrong and how to detect it
```

### Step 6: Stress test the plan

Challenge the plan against these failure modes:

| Category | Question |
|----------|----------|
| **Financial** | Can this double-process a transaction? Can it lose funds? Create phantom escrow balances? |
| **Concurrency** | What happens if two requests hit simultaneously? Are there race conditions? |
| **Idempotency** | Is every external-facing operation safe to retry? |
| **Rollback** | If this fails mid-deploy, what state is the system in? Is the migration reversible? |
| **Blockchain** | What if an RPC node is unreachable? What about Solana transaction failures? |
| **Data integrity** | Are FK constraints satisfied? Are there orphaned records on failure? |
| **Security** | Does this expose PII? Are new endpoints authenticated? Rate limited? |
| **Observability** | Will we know if this breaks in production? What logs catch it? |

State:
- The **most likely failure mode** and its early warning sign
- The **fallback plan** if the biggest risk materializes

### Step 7: Present the plan

Output a structured plan with:

1. **Goal** — one sentence
2. **End state** — what "done" looks like
3. **Milestones** — ordered list with dependencies, files, and actions
4. **Critical path** — which milestones are sequential vs parallel
5. **Biggest risk** — and the mitigation
6. **Open questions** — anything that needs the user's input before starting

## Rules

- Do NOT write code — this skill produces a plan only
- Do NOT make assumptions about business logic — ask if unclear
- ALWAYS read relevant source files before planning changes to them
- ALWAYS read `schema.sql` before planning any database work
- Be direct. Challenge weak assumptions. A brutally honest plan beats a comfortable fantasy.
- If the user's goal is too vague to plan concretely, push back with specific questions rather than planning against guesses
- Flag when a goal conflicts with the intent hierarchy (e.g., "skip idempotency for speed")
