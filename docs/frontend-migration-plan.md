# Frontend Migration Plan: Align `yapbay` with Post-75af040 `yapbay-api`

## Context

Since commit `75af040a` the yapbay-api backend has undergone a sweeping hardening pass (~110 commits). The frontend at `../yapbay` was built against the *pre*-hardening contract and is now misaligned in several load-bearing ways: it sends numeric amounts where strings are now required, sends `escrow_id` as a JS number where the schema expects a string (Solana u64 loses precision above 2⁵³), holds six stale API exports that point at endpoints which never existed in this backend, does not send the now-mandatory `Idempotency-Key` header on financial mutations, unwraps response shapes that have since been re-wrapped (and vice-versa), reads error messages from a path that has moved, and has a health-check surface that has split into three endpoints.

The system is dev-only and has no users, so this is a **hard cutover** — no compatibility shims, no feature flags, no gradual rollout. The goal is to bring the frontend fully back into spec with the current API in a single coordinated migration.

## End State

- Every outbound request from yapbay conforms to the strict Zod schemas in `yapbay-api/src/schemas/**`.
- All monetary fields in requests are decimal strings (USDC up to 6dp, fiat up to 2dp); no `Number()`, `parseFloat()`, or implicit coercion anywhere on the money path. Compile-time enforcement via generated types; CI-time enforcement via grep.
- `escrow_id` is a `string` end-to-end (hex for EVM, u64 decimal for Solana) — never a JS number.
- `POST /escrows/record`, `POST /transactions`, and other idempotent financial mutations carry a per-attempt UUIDv4 `Idempotency-Key` header **minted at user-intent time, not inside the HTTP client**.
- The two escrow-record variants (EVM, Solana) are exposed as two separate typed wrappers in the frontend API layer, dispatched at the call site by the network already known to the caller.
- The six dead API exports in `src/api/index.ts` are removed. All on-chain operations continue to route through `src/services/chainService.ts` (already in place and working).
- Response unwrapping matches the new envelopes exactly (`{ network, trade }`, `{ network, offer }`, `{ network, offers }`).
- Error handling surfaces the new structured error body (`error.code`, `error.message`, `error.issues[]`, `error.fields[]`), including new codes `validation_error`, `missing_idempotency_key`, `idempotency_key_conflict`, `resource_finalized`, `referenced_resource_missing`, `retry_conflict`, `conflict`.
- The Status page and Footer use the new `/health`, `/health/live`, `/health/ready` surfaces correctly.
- TypeScript types on the frontend are regenerated from the backend's machine-readable OpenAPI spec (`/openapi.json`) so drift is impossible by construction.
- Backend CORS `allowedHeaders` includes `Idempotency-Key` and `exposedHeaders` includes `Idempotent-Replayed` and `Retry-After`; this lands in prod **before** the frontend cutover.
- A persisted-state migration drains any pre-existing `pendingTransactions`/`incompleteEscrows` in localStorage so the boot path cannot send schema-invalid numeric amounts.
- `X-Request-Id` is captured on every error and surfaced as a "ref:" line in user-facing error banners for support correlation.

Single most important acceptance criterion: **Create an offer → start a trade → record escrow → fund → mark fiat paid → release, end-to-end, on solana-devnet, with no 400/404/409 surprises, no manual patching of localStorage, and the same idempotency key replays cleanly across a simulated token-refresh.**

---

## Design Invariants (encode in code + docs)

These are load-bearing rules that multiple milestones depend on. Violating any one of them causes silent corruption or duplicate money movement.

1. **Idempotency key is minted at user-intent time, not per HTTP attempt.** A single click = a single UUIDv4, used for every retry (network, 5xx, token-refresh, tab-reopen). The axios layer consumes the key; it does not generate one. If no key is present on a mutating POST to `/escrows/record` or `/transactions`, the client is buggy — log loudly and fail the request locally rather than quietly generating one.
2. **On-chain first, record second.** For every lifecycle action (fund, release, cancel, dispute, mark-fiat-paid), the client signs and confirms the on-chain transaction *before* calling `POST /transactions` / `POST /escrows/record`. If the recording POST fails, perform **at most one** bounded retry (1.5s), then stop: the backend listener reconciles missing records from chain events. Never re-submit to chain on recording failure.
3. **Amounts are strings on the money path; numbers only inside display formatters.** Display formatters are the *only* files allowed to call `.toFixed`, `Number(...)`, or `/1_000_000` on an amount-typed value, and they take `string` in and return `string` out. The generated type system enforces this at request boundaries; CI grep enforces it elsewhere.
4. **`escrow_id` is a string.** Derived, stored, sent, and compared as a string. No `Number(escrowId)`, no `parseInt`, no arithmetic on it. Solana u64 values exceed `Number.MAX_SAFE_INTEGER`.
5. **Per-network-family request shapes are separate types, not optional-field unions.** `recordSolanaEscrow` and `recordEvmEscrow` are two call-site APIs; the union in `src/api/index.ts:349-372` is deleted.

---

## Inventory of API Changes That Affect the Frontend

### 1. Monetary values are strings, not numbers

Backend `src/schemas/primitives/amounts.ts` defines:
- `usdcAmount` — regex `^(0|[1-9]\d*)(\.\d{1,6})?$`, > 0
- `escrowUsdcAmount` — same plus `<= 100.000000`
- `fiatAmount` — regex `^(0|[1-9]\d*)(\.\d{1,2})?$`, > 0

Affected frontend fields (all currently sent as `number` / coerced via `Number()` / `parseFloat()`):
- `POST /offers`: `min_amount`, `max_amount`, `total_available_amount` (strings); `rate_adjustment` stays `number` on request but comes back as **string** on response
- `PUT /offers/:id`: same as above
- `POST /trades`: `leg1_crypto_amount` (string, 6dp), `leg1_fiat_amount` (string, 2dp)
- `POST /escrows/record`: `amount` (string, 6dp, ≤100) — live call in `createTradeEscrow` / `createAndFundTradeEscrow` at `tradeService.ts:244`
- `POST /transactions`: `amount` already sent as `.toString()`, OK

All amount fields in **response bodies** are strings (`z.string()`), including derived fields like `current_balance` and `rate_adjustment`. Consumers that divide by `1_000_000` or call `toFixed()` must treat values as strings until the dedicated display formatter runs.

### 2. `escrow_id` is a string (EVM hex or Solana u64 decimal)

`src/schemas/escrows.ts` defines:
- `evmEscrowId` → hex string
- `solanaU64Id` → decimal string

Current frontend `recordEscrow` signature (`src/api/index.ts:353`) declares `escrow_id: number`. This is wrong for both families and **unsafe for Solana** (values > 2⁵³ silently truncate). Also affects `trade_onchain_id` (Solana u64 string), `escrow_onchain_id` (string in responses).

### 3. Per-network-family escrow record shapes

Backend routes `POST /escrows/record` through `validate((req) => ({ body: escrowRecordSchemaFor(req.network!.networkFamily) }))`. The two schemas differ:

- **EVM** (`evmEscrowRecordSchema`): requires `transaction_hash`, `escrow_id` (hex), EVM-formatted `seller`/`buyer`. No Solana fields.
- **Solana** (`solanaEscrowRecordSchema`): requires `signature`, `program_id`, `escrow_pda`, `escrow_token_account`, `trade_onchain_id`, `escrow_id` (u64 string), base58 `seller`/`buyer`. No EVM fields.

Both use `z.strictObject` — any field from the other family is a 400. The frontend cannot send a shared optional-field blob.

### 4. Six dead API exports (stale scaffolding, never wired up)

`git log -S` across the full yapbay-api history shows these URL strings only ever appeared in the initial commit (`aa8f40e`), which defined only `/escrows/create`. The current frontend exports:

- [src/api/index.ts:349-372](../../../repos/yapbay/src/api/index.ts#L349-L372) `recordEscrow` → `POST /escrows/record` — **LIVE**, kept (but reshaped per §2/§3)
- [src/api/index.ts:385-392](../../../repos/yapbay/src/api/index.ts#L385-L392) `fundEscrow` → `POST /escrows/fund` — **DEAD**
- [src/api/index.ts:394](../../../repos/yapbay/src/api/index.ts#L394) `getEscrow(tradeId)` → `GET /escrows/:tradeId` — **DEAD**
- [src/api/index.ts:422-431](../../../repos/yapbay/src/api/index.ts#L422-L431) `releaseEscrow` → `POST /escrows/release` — **DEAD**
- [src/api/index.ts:445-453](../../../repos/yapbay/src/api/index.ts#L445-L453) `cancelEscrow` → `POST /escrows/cancel` — **DEAD**
- [src/api/index.ts:467-475](../../../repos/yapbay/src/api/index.ts#L467-L475) `disputeEscrow` → `POST /escrows/dispute` — **DEAD**
- [src/api/index.ts:478-482](../../../repos/yapbay/src/api/index.ts#L478-L482) `markTradeFiatPaid` (the POST variant) → `POST /escrows/mark-fiat-paid` — **DEAD**

These six are **never imported** outside `api/index.ts` itself. Verified by grep across `src/**` and `**/*.tsx`. The real on-chain lifecycle is already implemented in `src/services/chainService.ts` (`checkAndFundEscrow:212`, `markFiatPaidTransaction:235`, `releaseEscrowTransaction:270`, `disputeEscrowTransaction:372`, `checkEscrowState:432`, `cancelEscrowTransaction:468`) via the Anchor program in `src/blockchain/networks/solana/program.ts`.

One live REST call remains for fiat-paid: [src/api/index.ts:322-323](../../../repos/yapbay/src/api/index.ts#L322-L323) `markFiatPaid(id)` issues `PUT /trades/:id` with `{fiat_paid: true}`. Still valid per `updateTradeRequestSchema`.

### 5. `Idempotency-Key` header is mandatory on financial mutations

Required on:
- `POST /escrows/record` — returns `400 missing_idempotency_key` if absent
- `POST /transactions` — same

Recommended (accepted but optional) on:
- `POST /trades` — enables safe retries of trade creation

Contract (from `yapbay-api/src/middleware/idempotency.ts`):
- Header value: UUIDv4 (case-insensitive, lowercase-normalized)
- Scope: `(key, user_sub)` — per user
- Body fingerprint: SHA-256 of `METHOD + originalUrl + canonical JSON body`
- Replay with same key + same body → cached 2xx response + `Idempotent-Replayed: true` response header
- Replay with same key + different body → `409 idempotency_key_conflict`
- Only 2xx responses are cached (4xx/5xx re-execute so clients can fix validation errors)
- TTL 24h

### 6. Backend CORS prerequisites (G1)

[src/server.ts:232](../src/server.ts#L232) currently:
```
allowedHeaders: ['Content-Type', 'Authorization', 'x-network-name', 'X-Request-Id']
```

Must extend **before** frontend cutover:
```ts
allowedHeaders: [
  'Content-Type',
  'Authorization',
  'x-network-name',
  'X-Request-Id',
  'Idempotency-Key',
],
exposedHeaders: [
  ...existing,
  'Idempotent-Replayed',
  'Retry-After',
]
```

### 7. Response envelope changes

| Endpoint | Old FE expectation | New API shape |
|---|---|---|
| `POST /trades` | `Trade` | `{ network, trade }` (201 Created) |
| `GET /trades/:id` | `Trade` | `{ network, trade }` |
| `GET /trades/my` | already `{ network, trades }` | unchanged |
| `POST /offers` | already `{ network, offer }` | unchanged |
| `PUT /offers/:id` | already `{ network, offer }` | unchanged |
| `GET /offers/:id` | already `{ network, offer }` | unchanged |
| `GET /offers` | already `{ network, offers }` | unchanged |
| `PUT /trades/:id` (incl. `markFiatPaid` path) | `{ id }` or `Trade` | `{ id }` — no other fields |
| `POST /transactions` | `{ success, transactionId, txHash?, signature?, blockNumber?, slot? }` | `{ success, transactionId, txHash, blockNumber }` — no `signature`/`slot` |

`tradeService.ts` partially handles `{ network, trade }` via a local type (line 22) and a defensive `.trade?.` unwrap at line 950. M5 hoists this into the typed API layer.

### 8. Strict request validation rejects unknown fields

Every request schema is `z.strictObject(...)`. Known audit targets:
- `POST /offers`: `createOfferRequestSchema` **requires** `creator_account_id`. `CreateOfferPage.tsx:33` fetches the account; wire the id in.
- `PUT /offers/:id`: `updateOfferRequestSchema` excludes `creator_account_id`, `created_at`, `updated_at`, `id`, `network_id`. Frontend's `Partial<Omit<Offer, ...>>` still permits `network_id` through. Strip before send.

### 9. Pagination on list endpoints

Supported (optional) params: `limit` 1..100 (default 25), `offset` 0..100_000 (default 0). Pages that currently fetch full lists then filter client-side (`MyOffersPage.tsx:80`, `MyTradesPage.tsx:57`, `MyEscrowsPage.tsx:72`) must paginate server-side.

### 10. Network header rename

[src/api/index.ts:73](../../../repos/yapbay/src/api/index.ts#L73) already sends `X-Network-Name`. Legacy `setNetworkId` shim at line 82 is dead — remove.

### 11. Structured error response shape

```json
{
  "error": {
    "code": "validation_error" | "missing_idempotency_key" | "idempotency_key_conflict"
          | "resource_finalized" | "referenced_resource_missing" | "retry_conflict"
          | "conflict" | "invalid_value" | "missing_field" | "not_found"
          | "unauthorized" | "forbidden" | "rate_limited",
    "message": "...",
    "details": { "request_id": "req_...", "timestamp": "...", "path": "...", "method": "...", "retry_after": null | number },
    "issues": [ { "code": "too_small", "message": "...", "path": "body.amount", "expected": "..." } ],
    "fields": [ "email", "wallet_address" ]
  }
}
```

Current frontend reads `error.response.data.message` ([src/utils/errorHandling.ts](../../../repos/yapbay/src/utils/errorHandling.ts)). New path: `error.response.data.error.message`.

### 12. Health endpoint split

- `GET /health/live` — cheap liveness (always 200)
- `GET /health/ready` — readiness (200/503, `{ status, checks }`)
- `GET /health` — expensive aggregate (new `apiVersion`, `contractVersion`, `eventListeners`)

### 13. Finalized-row immutability (`YB001` → `409 resource_finalized`)

- escrows: `state` ∈ `RELEASED`/`CANCELLED`/`AUTO_CANCELLED`/`RESOLVED`
- trades: `overall_status` ∈ `COMPLETED`/`CANCELLED`
- transactions: `status` ∈ `SUCCESS`/`FAILED`

### 14. Rate limits, HTTPS, JWT aud

- 500 req/min per user globally, 5000 in sandbox, 5/15min on admin login
- Production enforces HTTPS (`403` on plain HTTP) — `VITE_API_URL` in `.env.production` must be `https://`
- If `JWT_AUDIENCE` is set on the backend, Dynamic-issued tokens must carry matching `aud` (coordinate with Dynamic dashboard config)

---

## Milestones

Milestones are named with a G-prefix for deploy gates and M-prefix for migration work.

### G1 — Backend prerequisites [must land in prod before any M2+ frontend deploy]

**File:** `yapbay-api/src/server.ts:232-240`

**Actions:**
1. Extend `allowedHeaders` with `Idempotency-Key`.
2. Extend `exposedHeaders` with `Idempotent-Replayed` and `Retry-After`.
3. Deploy to prod.
4. **Verify from an external host:**
   ```
   curl -iX OPTIONS https://<api>/escrows/record \
     -H 'Origin: https://<frontend>' \
     -H 'Access-Control-Request-Method: POST' \
     -H 'Access-Control-Request-Headers: idempotency-key,content-type,authorization'
   ```
   Response must include `idempotency-key` in `access-control-allow-headers`.
5. Record the verification timestamp in the deploy log. Frontend M2 deploy is blocked until this check passes in prod.

**Risk:** None in the change itself. The risk is skipping the prod verification step and assuming merge == deploy.

### M1 — Foundation: types, config, env [parallelizable with G1]

**Depends on:** G1 (to hit `/openapi.json` in prod); otherwise runnable against local API.

**Files:**
- `yapbay/src/types/api.generated.ts` — produced by `openapi-typescript` against `/openapi.json`
- `yapbay/openapi.snapshot.json` — committed snapshot for drift detection
- `yapbay/package.json` — devDep `openapi-typescript`; scripts `gen:api-types`, `check:api-drift`
- `yapbay/src/types/index.ts` — re-export generated types; keep hand-written row types for joined columns the spec doesn't register
- `yapbay/.env`, `yapbay/.env.production` — confirm `VITE_API_URL` is `https://` in prod; add `VITE_DEBUG_IDEMPOTENCY=false`

**Actions:**
1. Hit `/openapi.json` against local API; persist as `openapi.snapshot.json`.
2. Generate types, commit under `src/types/api.generated.ts`.
3. Wire `pnpm gen:api-types && git diff --exit-code openapi.snapshot.json src/types/api.generated.ts` into CI.
4. Make generated types **strict** — a type check failure here is the M3 work queue.

**Risk:** OpenAPI spec won't cover every joined-response field. Mitigation: keep hand-written `tradeRow`/`offerRow`/`escrowRow` types for now; use generated types only for request bodies and simple responses.

### M2 — API client hardening [blocks M3..M8; depends on G1 in prod + M1]

**Depends on:** G1 (prod), M1.

**Files:**
- `yapbay/src/api/client.ts` — NEW (axios + interceptors)
- `yapbay/src/api/idempotency.ts` — NEW (key minting helper + UUIDv4 fallback)
- `yapbay/src/api/errors.ts` — NEW (`ApiError` class)
- `yapbay/src/api/{accounts,offers,trades,escrows,transactions,health}.ts` — split from index.ts
- `yapbay/src/api/index.ts` — barrel re-exports
- `yapbay/src/utils/errorHandling.ts` — rewritten

**Actions:**
1. **Idempotency key lifecycle (per invariant 1):**
   - Export `newIdempotencyKey(): string` from `api/idempotency.ts`. It prefers `crypto.randomUUID()`, falls back to a v4 implementation from a well-known constant-time source (inline 10-line function producing the exact regex `idempotency.ts:34` enforces).
   - POST functions for `/escrows/record` and `/transactions` **require** the key as an explicit argument. No interceptor fallback: if the arg is missing, throw a `ClientError("idempotency key required at call site")` in dev and fail the request in prod with an error loudly logged. This catches the StrictMode / double-mount failure mode at the type level.
   - Callers mint the key once per user intent (the submit handler) and thread it through any retry loop.
2. **Response interceptor:**
   - Extracts `X-Request-Id` → attaches to thrown `ApiError`.
   - Reads `Idempotent-Replayed` → logs when `VITE_DEBUG_IDEMPOTENCY=true`.
   - On `409 retry_conflict`, honors `Retry-After` with **one** bounded retry (same key, same body).
3. **ApiError class** (`api/errors.ts`): fields `code`, `message`, `status`, `requestId`, `issues`, `fields`, `retryAfter`. Helper `issuesByField(err): Record<string, string[]>` that strips `body.|query.|params.|headers.` path prefix.
4. **`handleApiError()` rewrite:** reads `err.response.data.error.message` first (new shape); falls back to legacy `err.response.data.message` (not for prod, for the migration window only — remove after M10).
5. Remove `setNetworkId` legacy shim.

**Risk:** The call-site-mint contract only works if every financial-POST caller is threading the key correctly. Mitigation: the type signature **makes the key a required argument**; TS refuses to compile if a caller omits it.

### M3 — Money layer: amounts and ids as strings everywhere [biggest risk]

**Depends on:** M1 (generated types will surface every violation as a TS error), M2.

**Files** (enumerated from grep `parseFloat|toFixed|/ 1_000_000|Number\(`):
- `yapbay/src/utils/amounts.ts` — NEW
- `yapbay/src/api/trades.ts`, `api/escrows.ts`, `api/offers.ts` — amount types
- `yapbay/src/services/tradeService.ts` — lines 149, 155, 217, 233, 244, 247, 321
- `yapbay/src/offer/CreateOfferPage.tsx:109-112`
- `yapbay/src/offer/EditOfferPage.tsx:123`
- `yapbay/src/offer/OfferDetailPage.tsx`
- `yapbay/src/my/MyOffersPage.tsx`, `my/MyEscrowsPage.tsx`, `my/MyTradesPage.tsx`
- `yapbay/src/Home.tsx` (offer listings)
- `yapbay/src/Header.tsx:60` (USDC balance display)
- `yapbay/src/components/Trade/**` (TradePage, TradeDetailsCard, TradeCalculatedValues, TradeStatusDisplay/EscrowDetailsPanel, TradeConfirmationDialog/calculateTradeAmounts + validateAndConfirmTrade)
- `yapbay/src/components/Offer/**` (OfferDescription, DesktopOfferTable, MobileOfferList)
- `yapbay/src/hooks/useTradeConfirmation.ts`, `hooks/useAmountInput.ts`, `hooks/useEscrowDetails.ts`
- `yapbay/src/utils/stringUtils.ts`, `utils/pendingTransactions.ts`
- `yapbay/src/lib/utils.ts`

**Actions:**
1. Create `utils/amounts.ts`:
   - `toUsdcString(input: string | number | bigint): string` — validates 0..max, 6dp, no leading zeros; throws at boundary on bad input
   - `toFiatString(input, dp=2): string` — same for fiat
   - `formatUsdcForDisplay(s: string, dp=2): string` — pure presentation, never feeds back into API
   - `microToUsdcString(micro: bigint): string` — for on-chain balance reads (BigInt → decimal string, never via `Number`)
2. Create `utils/money-display.ts` — the **only** file exempt from the CI grep rule. Contains display-only formatters. Takes `string` in, returns `string` out. Move existing display helpers out of `stringUtils.ts` and `lib/utils.ts` into this file.
3. Replace every `parseFloat(amount)` / `Number(amount)` in the file list with `toUsdcString(amount)`. Let the TS compiler errors from the generated types drive the enumeration — any remaining coercion is the CI grep's job.
4. Update type signatures for `recordSolanaEscrow`, `recordEvmEscrow`, `createTrade` to accept `amount: string`, `leg1_crypto_amount: string`, `leg1_fiat_amount: string`.
5. **`escrow_id` becomes `string` end-to-end** (invariant 4). Update `src/services/tradeService.ts` `generateEscrowId` to return `string`, `deriveSolanaAddresses` to take `string`, all `escrow_id` fields in API types to `string`. Use `BN.toString()` from Anchor for u64 conversion; never `bn.toNumber()`.
6. CI grep (fails the build if non-empty):
   ```
   grep -rE '\b(parseFloat|parseInt|Number\()' src/ \
     --include='*.ts' --include='*.tsx' \
     | grep -v 'src/utils/money-display.ts' \
     | grep -E '(amount|balance|price|total)'
   ```
7. CI grep #2 — no `Number(escrowId)`, `parseInt(escrowId)`, `BN.toNumber()`:
   ```
   grep -rE '(Number|parseInt)\([^)]*escrow_?id|\.toNumber\(\)' src/
   ```

**Risk:** Silent precision loss on intermediate arithmetic. Mitigation: string arithmetic on the money path (add a `addUsdc(a: string, b: string): string` helper using scaled BigInt if any call site actually needs arithmetic — if none do, don't write it).

### M4 — Dead-code removal + persisted-state migration

**Depends on:** M3 (so the remaining code path is consistent).

**Files:**
- `yapbay/src/api/index.ts` — delete six stale exports + `EscrowResponse`
- `yapbay/src/services/tradeService.ts:408-554` — remove dead localStorage fallback paths
- `yapbay/src/utils/pendingTransactions.ts` — localStorage schema migration + removal
- `yapbay/src/App.tsx` — boot-time drain step

**Actions:**
1. Delete exports for `fundEscrow`, `releaseEscrow`, `cancelEscrow`, `disputeEscrow`, `markTradeFiatPaid` (POST variant), `getEscrow(tradeId)`, and the `EscrowResponse` interface.
2. Delete `storeIncompleteEscrowLocally` (tradeService.ts:450) and `retryPendingTransactions` (:480). These were designed around a two-step server-signed flow that never existed.
3. **localStorage migration (boot-time, runs once per user per origin):**
   - On App boot, before any API call, read keys `pendingTransactions` and `incompleteEscrows`.
   - If present, attempt to coerce numeric amount fields to `toUsdcString()`; on failure, drop the entry.
   - Log a single "migrated N pending entries" info line.
   - Delete both keys after migration; write a sentinel `yapbay.migrations.v2 = true` to avoid re-running.
4. `tsc --noEmit` must pass; no caller should surface.
5. Keep `recordSolanaEscrow` / `recordEvmEscrow` (split from `recordEscrow`, per M5).
6. Keep `markFiatPaid` at line 322 (live, `PUT /trades/:id` with `{fiat_paid: true}`).

**Risk:** Users with stale localStorage could hit NaN without the migration. Mitigation: the explicit drain step; exception: if in-flight bugs prevent the sentinel from being set, we risk re-draining — safe because the second drain is a no-op against empty keys.

### M5 — Per-family escrow API, response unwrap, form plumbing

**Depends on:** M1, M2, M3.

**Files:**
- `yapbay/src/api/escrows.ts` — NEW (split from index.ts)
- `yapbay/src/api/trades.ts` — NEW
- `yapbay/src/services/tradeService.ts` — call-site updates
- `yapbay/src/services/chainService.ts` — return types if needed (string escrow_id)
- `yapbay/src/hooks/useTradeDetails.ts`
- `yapbay/src/offer/CreateOfferPage.tsx` — `creator_account_id`
- `yapbay/src/offer/EditOfferPage.tsx` — strip `network_id` / timestamps before PUT

**Actions:**
1. **Split escrow record into two typed wrappers** (invariant 5):
   ```ts
   // api/escrows.ts
   export const recordSolanaEscrow = (
     data: SolanaEscrowRecordRequest,
     idempotencyKey: string
   ) => client.post<EscrowRecordResponse>('/escrows/record', data, {
     headers: { 'Idempotency-Key': idempotencyKey },
   });

   export const recordEvmEscrow = (
     data: EvmEscrowRecordRequest,
     idempotencyKey: string
   ) => client.post<EscrowRecordResponse>('/escrows/record', data, {
     headers: { 'Idempotency-Key': idempotencyKey },
   });
   ```
   Types `SolanaEscrowRecordRequest` / `EvmEscrowRecordRequest` come from the generated OpenAPI types (M1). Callers dispatch by network — `tradeService.ts` already knows the family via `blockchainService.getCurrentNetwork()`.
2. Change `createTrade` return to `{ network, trade }`; update callers at `tradeService.ts:155, :948` and `useTradeDetails.ts:36` to read `.trade`. Collapse the existing defensive unwrap into the typed layer.
3. Change `getTradeById` return to `{ network, trade }`; update callers.
4. **Audit `PUT /trades/:id` response consumers** — the response is `{ id }` only. Grep every call site of `markFiatPaid()` / `updateTrade()`; any that dereferences a field other than `id` must be corrected to refetch via `getTradeById`.
5. `CreateOfferPage.tsx`: include `creator_account_id` from the account fetched at line 33. Strip any field not in `createOfferRequestSchema`.
6. `EditOfferPage.tsx`: strip `network_id`, `id`, `creator_account_id`, timestamps before sending.

**Risk:** `creator_account_id` may have been inferred from JWT before — verify with a fresh account end-to-end before merging.

### M6 — Error UX

**Depends on:** M2.

**Files:**
- `yapbay/src/utils/errorHandling.ts` (done in M2; extended here)
- `yapbay/src/components/Account/{Create,Edit}AccountForm.tsx` — lines 54, 98
- `yapbay/src/offer/{Create,Edit}OfferPage.tsx` — inline per-field errors
- `yapbay/src/services/tradeService.ts` — toasts for 409 and 429
- `yapbay/src/components/shared/ErrorBanner.tsx` — NEW (reusable, includes `ref: req_xyz` line)

**Actions:**
1. `handleApiError(err)` returns `ApiError` (from M2). Forms use `issuesByField(err)` to render per-field errors.
2. Global toast for `429 rate_limited` — honor `Retry-After` numerically and display "try again in N s".
3. On `409 resource_finalized` during a trade action: refetch the trade via `getTradeById`, replace local state, navigate to `/trades/:id`, toast "this trade is already complete".
4. On `409 idempotency_key_conflict`: **this is a frontend bug**. Log to console.error with full `err.requestId` and a stack trace. Toast once: "A duplicate request was detected — please reload."
5. `X-Request-Id` surfaced as a small subtle "ref: req_xyz" line under every error banner/toast, for support correlation. Also attached to any console.error payload.

### M7 — Health / Status page update

**Depends on:** M2.

**Files:**
- `yapbay/src/api/health.ts` — `getLiveness()`, `getReadiness()`, `getHealth()`
- `yapbay/src/Footer.tsx:14` — switch to `getLiveness()`
- `yapbay/src/pages/Status.tsx:155` — keep `getHealth()`; add a `/ready` panel
- `yapbay/src/types/index.ts` — health response types (from M1)

### M8 — Pagination on list pages

**Depends on:** M2.

**Files:** `yapbay/src/my/My{Offers,Trades,Escrows,Transactions}Page.tsx`, `Home.tsx`.

**Actions:** shared `usePagedQuery` hook, `?limit=25&offset=0` defaults, Next/Prev controls, remove client-side list filtering.

### M9 — (removed; promoted to G1 as prerequisite gate)

### M10 — Verification, drift detection, cleanup, rollback

**Depends on:** all prior milestones.

**Actions:**
1. `yapbay/scripts/check-api-drift.sh` — CI check: regenerate types from `/openapi.json`, diff against committed snapshot, fail on drift.
2. Golden-path verification (see below).
3. Failure-mode verification:
   - Token expiry mid-flow: force a JWT refresh between on-chain confirm and `POST /transactions`. Use the *same* idempotency key. Expect a successful record and `Idempotent-Replayed: true` on the second attempt if the first was cached.
   - Simulate `POST /transactions` returning 500 after a confirmed on-chain tx. Verify the backend listener inserts the transaction row within its polling window (cross-reference `src/listener/` config).
   - Wallet disconnect mid-sign: no `POST /transactions` should fire; UI surfaces a reconnect prompt.
   - Concurrent submit from two tabs: advisory lock on backend serializes; UI shows the same result for both tabs.
   - `429 rate_limited`: hammer `/prices` above 500/min; toast shows `Retry-After`.
   - `409 retry_conflict`: inject a pg deadlock (if feasible) or mock it; confirm one bounded retry, then surface.
   - Tab refresh mid-flight: the in-flight idempotency key must be recoverable (either persisted alongside the pending transaction or abandoned cleanly so a fresh submit uses a new key). State the chosen strategy (below).
4. Remove M2's legacy-error-shape fallback in `handleApiError`.
5. Update `yapbay/README.md` referencing the new endpoint list and error codes.

---

## Critical Path

```
G1 (backend CORS, prod-verified) ──┐
M1 (types) ────────────────────────┼──> M2 (API client) ──┬──> M3 (amounts + escrow_id strings)
                                    │                     ├──> M4 (dead code + localStorage drain)
                                    │                     ├──> M5 (per-family API + unwrap + forms)
                                    │                     ├──> M6 (error UX)
                                    │                     ├──> M7 (health split)
                                    │                     └──> M8 (pagination)
                                                                              │
                                                                              └──> M10 (verify + cleanup)
```

**Sequential backbone:** G1 (prod) → M1 → M2 → M3 → M10. M4, M5, M6, M7, M8 can run in parallel once M2 lands. M3 → M5 ordering matters because M5's typed wrappers consume the string `amount` / `escrow_id` types M3 establishes.

## Biggest Risk

**M3 (money + id as strings) is the single biggest risk.**

- At least 29 files touch `parseFloat|toFixed|/1_000_000|Number(` on money or escrow ids (verified by grep across `src/**`).
- The failure mode is **runtime**: `"1.5".toFixed(2)` throws at display time; `Number("18446744073709551615")` truncates Solana u64 silently.
- Generated types (M1) catch request-side errors at compile time — but display-side reads require CI grep + eyeballing.

**Early warning signs:**
- `POST /offers` → `400 validation_error`, `issues[0].path === "body.min_amount"`, expected string.
- Status page shows `NaN` in a balance cell.
- `POST /escrows/record` succeeds but the escrow DB id doesn't round-trip correctly (precision loss on Solana u64).

**Fallback plan:** ship a debug-only axios interceptor that `console.warn`s when any request body has a numeric field named `*amount*` or `escrow_id`. Enable in dev; confirm zero warnings before pushing to prod.

## Secondary Risks

1. **Idempotency key misuse in StrictMode** — mitigated by invariant 1 + the call-site-mint type contract (M2).
2. **CORS rollback mismatch** — G1 is backward-compatible; safe to keep in prod regardless of frontend state.
3. **Dynamic wallet session expiry** — M10 test covers this.
4. **`crypto.randomUUID()` on non-secure contexts** — UUIDv4 fallback in `api/idempotency.ts`.
5. **Listener backfill latency** — if the listener takes > 60s, users may briefly see a trade with no transaction row. Document the window; show a "recording on-chain..." state while the row is missing.

## Rollback Strategy

**Rollback is all-or-nothing.** The backend schemas are strict by design; we will **not** temporarily accept numeric amounts or number `escrow_id`s to cushion a partial rollback. Any rollback reverts the entire frontend migration.

Procedure:
1. Before the M-series merge, tag the current frontend as `pre-migration-<date>`.
2. Deploy M3+ as a single frontend release. Keep the pre-migration tag pinned in S3/static host for 72h.
3. If prod breaks after cutover:
   - Immediately re-deploy `pre-migration-<date>`.
   - The backend stays as-is — pre-migration frontend sent numeric amounts and always would have failed against the new schemas. So "rollback" means both prod frontend **and** prod validation failing for all users until fixed forward. This is acceptable only because system is dev-only; **do not use this procedure once there are real users**.
4. Fix forward: identify the M3 bug, ship a patch release, re-deploy.

G1 is independently rollback-safe (CORS is additive; removing the new `allowedHeader` only breaks the new frontend, which is already rolled back).

## Out of Scope / Known Risks

- **JWT stored in `localStorage`** — an XSS exfiltration target. `api/index.ts:26,65-68` reads/writes `jwt_token` from localStorage. Not addressed in this migration; tracked as a follow-up. Mitigations that would need their own plan: `httpOnly` cookie (requires backend cooperation), `sessionStorage` (survives reload but not tab close), in-memory + silent refresh via Dynamic SDK.
- **Admin routes exposure** — `schemas/admin.ts` exists on the backend. `grep -r '/admin' yapbay/src/` confirms the frontend consumes none. Documented negative.
- **Legacy Celo / EVM support** — schemas accept both, so server-side is live. The frontend's EVM code path (`YapBayEscrow.ts` Hardhat artifact, viem integration) gets the same M3 string-amount / M5 per-family treatment but is tested only if EVM is in scope for this sprint. Confirm before M10.

## Open Questions

1. **Anchor IDL freshness:** `yapbay/src/utils/YapBayEscrow.json` is the EVM Hardhat artifact. The Solana IDL lives under `src/blockchain/networks/solana/`. Add `pnpm sync:idl` that copies from `yapbay-api/src/contracts/solana/` — confirm the canonical source file path.
2. **Account lookup by wallet address:** several flows need account id from wallet. Routes today: `GET /accounts/me`, `GET /accounts/:id`, `POST /accounts`. No `GET /accounts?wallet_address=`. Add to backend, or embed in trade/offer joined responses?
3. **`rate_adjustment` asymmetry:** number on request, string in response. Intentional (pg `DECIMAL` serializes as string) or a backend bug to normalize? Decision needed so generated types don't break consumers.
4. **In-flight idempotency key persistence:** for tab refresh mid-flight — do we persist `{intent, key}` in localStorage so a resumed flow reuses the key, or abandon and let the user resubmit (new key, new execution)? Recommend: persist for on-chain-confirmed-but-unrecorded intents; abandon for pre-chain intents (user can safely resubmit).
5. **`X-Request-Id` display policy:** show on every error, or only on 5xx/409? Recommend: show on all errors so users can quote it.

---

## Verification

### Golden path (solana-devnet, fresh DB, fresh wallet)

1. Connect Dynamic → JWT exchange → `GET /accounts/me` 404 → create form shown.
2. `POST /accounts` → 201 → `GET /accounts/me` 200.
3. From another account: `POST /offers` with string amounts, `creator_account_id`, no stray fields → `{ network, offer }` unwraps → offer appears in `GET /offers?owner=<wallet>`.
4. From a taker: `POST /trades` with `leg1_offer_id`, string amounts, `Idempotency-Key` minted at submit → `{ network, trade }` unwraps.
5. `createTradeEscrow` builds Anchor ix, seller signs, confirms; then `recordSolanaEscrow(data, key)` with the **same** intent key → 201 → `GET /escrows/my` includes the row (with string `amount`, string `escrow_id`).
6. `checkAndFundEscrow` fund ix, confirm; `POST /transactions` with `FUND_ESCROW` + signature + key → 201 → visible in `GET /transactions/trade/:id`.
7. **Idempotency replay:** repeat step 6 with same key + same body → same response + `Idempotent-Replayed: true` header.
8. `markFiatPaidTransaction` chain call + `POST /transactions MARK_FIAT_PAID` + `PUT /trades/:id {fiat_paid: true}` → state advances.
9. `releaseEscrowTransaction` + `POST /transactions RELEASE_ESCROW` → listener detects `EscrowReleased`, sets escrow state `RELEASED`.

### Failure-mode cases (required before shipping)

10. **Finalized immutability:** `PUT /trades/:id {overall_status: "IN_PROGRESS"}` on a completed trade → `409 resource_finalized` → UI refetches, navigates, toasts.
11. **Validation error:** `POST /offers` with `min_amount: 1.5` (number) → `400 validation_error`, `issues[0].path === "body.min_amount"` → form highlights the field with the Zod message.
12. **Rate limit:** hammer `/prices` above 500/min → `429` → toast with `Retry-After` seconds.
13. **Retry conflict:** simulate `40P01` → `409 retry_conflict` + `Retry-After: 1` → client auto-retries once, then surfaces.
14. **Missing idempotency key (defensive):** intentionally strip the header on a test `POST /escrows/record` → `400 missing_idempotency_key` → error surfaces (this should never hit prod — it's a frontend-bug canary).
15. **Idempotency replay after token refresh:** mid-flow, force a JWT refresh; resume with same key → `Idempotent-Replayed: true`.
16. **On-chain confirmed, recording POST fails:** mock 500 on `POST /transactions` after chain confirm → client does one bounded retry → gives up → listener backfills within its polling window → `GET /transactions/trade/:id` shows the row.
17. **Wallet disconnect mid-sign:** kill Dynamic session while the sign modal is up → no `POST /transactions` fires → UI prompts reconnect.
18. **Tab refresh mid-flight:** start a trade, refresh between sign and record → per Open Question 4 decision: either resume with same key (preferred) or show a "please resubmit" prompt.
19. **Concurrent submit from two tabs:** submit same trade from two tabs simultaneously → advisory lock serializes → both tabs show the same result.
20. **Solana u64 precision:** create an escrow with `trade_onchain_id` near `2^63 - 1`; round-trip through `recordSolanaEscrow` → `GET /escrows/my` → value unchanged (string equality).
21. **localStorage migration:** seed `pendingTransactions` with a numeric `amount` in a pre-migration state; boot the app → migration converts or drops; no API call is made with a numeric amount.
22. **CORS preflight:** from a fresh browser, preflight `POST /escrows/record` → response includes `idempotency-key` in `Access-Control-Allow-Headers` and `Idempotent-Replayed` + `Retry-After` in `Access-Control-Expose-Headers`.

### Drift check

23. `pnpm gen:api-types && git diff --exit-code openapi.snapshot.json src/types/api.generated.ts` → no diff.

---

## Critical Files (Reference)

Frontend (`/home/george9874/repos/yapbay/`):

- `src/api/client.ts`, `src/api/idempotency.ts`, `src/api/errors.ts` — new
- `src/api/{accounts,offers,trades,escrows,transactions,health}.ts` — split from index.ts
- `src/services/tradeService.ts` — amount/id string conversions, response unwrap, remove dead localStorage
- `src/services/chainService.ts` — return types (string escrow_id)
- `src/utils/amounts.ts`, `src/utils/money-display.ts` — new
- `src/utils/errorHandling.ts` — rewrite
- `src/utils/pendingTransactions.ts` — boot migration + removal
- `src/types/api.generated.ts` — new (from OpenAPI)
- `src/offer/CreateOfferPage.tsx`, `src/offer/EditOfferPage.tsx` — string amounts, `creator_account_id`, strict fields
- `src/components/Trade/**`, `src/components/Offer/**`, `src/components/Account/**` — string amount displays, structured errors
- `src/hooks/{useTradeDetails,useNetworkAwareAPI,useTradeConfirmation,useAmountInput,useEscrowDetails}.ts`
- `src/my/My{Offers,Trades,Escrows,Transactions}Page.tsx` — pagination
- `src/pages/Status.tsx`, `src/Footer.tsx` — health split
- `src/lib/utils.ts`, `src/utils/stringUtils.ts` — move display helpers to `money-display.ts`
- `src/App.tsx` — boot-time localStorage migration step

Backend (`/home/george9874/repos/yapbay-api/`) — G1:
- `src/server.ts:232-240` — CORS `allowedHeaders` + `exposedHeaders`
