# 0001 — Biome rule exemptions

**Status**: Accepted (2026-04-12)

## Context

`biome.jsonc` disables 24 rules from the `recommended` preset via the
`ultracite/biome/core` extension. Without a record of *why*, each
exemption looks like a free-standing invitation to re-enable it in
isolation — which then blows up a CI build on a tangentially-related PR
and wastes reviewer time.

This ADR documents the reason for each exemption so we can re-enable
incrementally with clear expectations about what each change will cost.

## Decision

Keep the current exemptions documented below. Re-enable in the priority
order listed. Do each rule in its own PR so the diff is reviewable.

### Style

| Rule | Reason disabled | Priority to re-enable |
|---|---|---|
| `useFilenamingConvention` | Mixed `camelCase.ts` + `PascalCase.ts` across the repo; mass rename would touch hundreds of imports. | P3 — cosmetic |
| `noNonNullAssertion` | `!` appears on JWT-verified fields that TypeScript can't narrow (e.g. `req.networkId!` after middleware). Fixing requires type guards throughout. | **P1 — financial-relevant**; `!` on money fields is a real bug source |
| `noNamespace` | Legacy Express type augmentation in `src/types/express.d.ts` uses `declare global { namespace Express { interface Request { ... } } }` — the standard idiom. | P4 — keep off permanently |
| `noParameterProperties` | Project uses class constructors with parameter properties in a few services. | P3 |
| `useConsistentMemberAccessibility` | Enforces explicit `public`/`private`. Codebase is inconsistent; would touch every class. | P3 |
| `noParameterAssign` | Currently mutates params in a few handlers (e.g. finalTransactionType). Not strictly buggy but worth revisiting with the idempotency/tracing work. | P2 |
| `noSubstr` | `.substr()` used in legacy string formatting. | P4 |
| `noNestedTernary` | Used in a few listener/log code paths. | P4 |
| `useDefaultSwitchClause` | Legacy state-machine switches lack default cases. | **P2 — state-machine correctness relevant** |
| `useReadonlyClassProperties` | Not worth the churn. | P4 |

### Complexity

| Rule | Reason disabled | Priority |
|---|---|---|
| `noForEach` | `.forEach` widely used; `for..of` preferred but not worth mass rewrite. | P4 |
| `noStaticOnlyClass` | A couple of service classes use static-only pattern intentionally. | P4 |
| `noExcessiveCognitiveComplexity` | Some financial handlers are genuinely complex (transaction recording, escrow state transitions). Enabling would require significant refactor. | **P1** — enable once we have property tests covering the behavior being refactored |

### Suspicious

| Rule | Reason disabled | Priority |
|---|---|---|
| `useAwait` | Async functions sometimes return promises by awaiting inner callbacks. Blind enforcement causes false positives. | P3 |
| `noEmptyBlockStatements` | A handful of intentional no-op catch blocks. Migration work (safeJsonParse) has eliminated most; next pass can re-enable. | **P2** |
| `noEvolvingTypes` | Several handlers build a result object progressively. | P3 |
| `noImplicitAnyLet` | `let x;` without an initializer. Cheap to fix but not urgent. | **P2** |

### Correctness

| Rule | Reason disabled | Priority |
|---|---|---|
| `noGlobalDirnameFilename` | Used in `src/utils/versionUtils.ts` to read `package.json` via `__dirname`. Legitimate in CommonJS output. | P4 |

### Performance

| Rule | Reason disabled | Priority |
|---|---|---|
| `noDelete` | Used to scrub PII fields before response. | P4 |
| `noNamespaceImport` | `import * as fs` pattern in a few services. | P3 |
| `noBarrelFile` | Route directories use `index.ts` as barrels. | P4 — keep off |
| `useTopLevelRegex` | Regex literals declared inside middleware closures. | P4 |

## Consequences

- Reviewers know which exemptions are load-bearing vs. technical-debt.
- P1/P2 rules become concrete backlog items with a measurable goal
  (clean Biome run with rule enabled).
- New exemptions require an ADR amendment, preventing drift.

## Alternatives considered

- **Enable everything now** — would break CI immediately; the plan's
  phased rollout exists precisely to avoid this.
- **Delete the exemptions without a record** — future contributors would
  reinvent the answers. ADR cost is a few paragraphs.
