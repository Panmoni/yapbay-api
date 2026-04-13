# Architecture Decision Records

This directory captures significant design decisions for yapbay-api. Each
ADR explains *why* a choice was made so future maintainers don't have to
reconstruct the trade-offs from git archaeology.

## Format

- Filename: `NNNN-short-slug.md` (4-digit sequence, zero-padded)
- Sections: **Context** → **Decision** → **Consequences** → **Alternatives**
- Status: `Accepted`, `Superseded by NNNN`, or `Deprecated`

## Index

- [0001 — Biome rule exemptions](0001-biome-rule-exemptions.md)
- [0002 — Dual-chain support (Solana + Celo)](0002-dual-chain-solana-celo.md)
- [0003 — BigInt micro-unit decimal arithmetic](0003-bigint-micro-unit-decimals.md)
- [0004 — Pino for structured logging with PII redaction](0004-pino-pii-redaction.md)
- [0005 — Idempotency keys for financial mutations](0005-idempotency-keys.md)
- [0006 — Coordinated graceful shutdown](0006-graceful-shutdown.md)
