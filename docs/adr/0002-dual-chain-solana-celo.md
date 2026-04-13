# 0002 — Dual-chain support (Solana + Celo)

**Status**: Accepted (2026-04-12) — Celo listeners currently disabled, code path preserved.

## Context

yapbay-api needs to escrow funds for P2P trades. A single-chain commitment
locks out users whose preferred wallets / stablecoins live elsewhere, and
exposes the entire platform to one chain's downtime. Users on Solana want
low fees and fast finality; users on Celo / EVM want the widest stablecoin
support.

## Decision

Support two chains behind a network-family abstraction:

- **Solana** (devnet + mainnet) — primary active chain. On-chain program
  written in Anchor, PDA-based escrow state.
- **Celo** (EVM) — structure preserved (routes, listeners, schema), but
  listeners are disabled until the Solana rollout stabilizes.

Every mutable route requires `x-network-name` header, mapped via
`src/services/networkService.ts` to a `NetworkConfig` row. Downstream
services dispatch on `networkFamily ∈ { 'solana', 'evm' }`.

## Consequences

- 2× test surface (Solana Connection calls + ethers.js contract calls).
- Event listeners per chain; `src/listener/multiNetworkEvents.ts`
  orchestrates them and reports health.
- Schema carries address fields large enough for both families (Solana
  base58 up to 44 chars, EVM hex 42 chars — chose VARCHAR(128) per
  migrations 0028-0031).
- Reconciliation job must be chain-aware: each chain has its own balance
  fetcher signature.

## Alternatives considered

- **Solana-only**: simpler, but blocks the Celo user base already onboarded
  from the legacy EVM product.
- **Abstract via a generic ledger interface**: premature abstraction — the
  two chains' finality, fee, and token models differ enough that a
  one-size-fits-all interface leaks.
