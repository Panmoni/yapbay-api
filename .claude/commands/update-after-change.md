# Update After Change (Docs, Lint, Tests)

Run this **before committing**: after you make code changes (new features, fixes, refactors), run this to update documentation, fix lints, and verify tests. Then commit everything together so each commit is complete.

## What to Keep Updated

When you change code, update as needed:

| Area | What to do |
|------|------------|
| **Documentation** | Update `docs/` files and any README in the touched area. |
| **Lint** | Run Biome and Ultracite; fix new issues so the count does not increase. |
| **Tests** | Add or adjust tests for new/changed behavior; run only **tightly related** tests; fix only *new* failing tests. |
| **Types / API contract** | If you changed request/response shapes or routes, update types and `docs/api-ref.md`. |
| **Env / config docs** | If you added env vars or config, update relevant docs. |
| **Dependencies** | If you added/removed deps, run `npm audit` and update docs that list dependencies. |

## Steps (in order)

1. **Identify what changed**
   - Use **unstaged** and **untracked** paths as the change set: `git diff --name-only` (unstaged) and `git ls-files --others --exclude-standard` (untracked), or the files the user indicates.
   - Note: new or changed routes, services, env vars, migrations, and config.

2. **Documentation**
   - For each touched area, update the relevant docs:
     - `docs/` for deep dives (e.g. `docs/migrations.md`, `docs/api-ref.md`, `docs/transaction-api.md`).
   - If APIs changed: types, endpoint list, and `docs/api-ref.md`.
   - If env or config changed: update relevant docs.

3. **Lint**
   - Run: `npm run format:write` then `npm run lint:fix`.
   - Then: `npm run check` (ultracite).
   - If there are remaining issues, fix new or regressed issues. Do not leave new lint errors introduced by the change.

4. **Tests** — find tightly-related tests only

   **a. Classify each changed file** from the change set (unstaged + untracked). Skip non-source files (docs, config, etc.) and migration files. If nothing remains, skip the test run.

   **b. Select test files** using these rules — collect matches from all applicable rules, then de-duplicate:

   | Changed file type | How to find tests |
   |---|---|
   | **Test file** (`src/tests/**/*.test.ts`) | Run it directly. |
   | **Test utility** (`src/tests/utils/`) | Run all tests that import it. |
   | **Any other source file under `src/`** | Apply **both layers** below. |

   **Two-layer test selection** (apply both, union the results):

   - **Layer 1 — Name match:** Take the basename of the changed file (without extension). Glob for `src/tests/**/<basename>*.test.ts` and `src/tests/**/*<keyword>*.test.ts` where keyword is the domain name from the path.
   - **Layer 2 — Direct import scan:** Grep all `src/tests/**/*.test.ts` files for import lines containing the changed file's path suffix. This finds tests that directly import the file but aren't named after it.

   **No matches found:** Report "no closely related tests found" — do NOT fall back to running all tests. The user can run the full suite manually if they want.

   **c. Run the selected tests:** `npx mocha -r ts-node/register <test-file-paths>`

   **d. Evaluate results:**
   - Only fix failures that are **new** (clearly caused by the current change).
   - Add tests for new behavior where appropriate.

5. **Optional follow-ups**
   - **Types**: Run TypeScript build (`npm run build`) and fix type errors.
   - **Dependencies**: If deps were added, run `npm audit` and update docs.

## Commands reference

- Format + lint fix: `npm run format:write` then `npm run lint:fix` then `npm run check`
- Tests (scoped): `npx mocha -r ts-node/register <test-file-paths>`
- Full suite: `npm test`
- Build (types): `npm run build`

## Output

- Summarise what you updated (docs, lint fixes, test changes).
- List any remaining lint issues or failing tests that need manual follow-up.
- If you did not change something (e.g. env docs), say so briefly so the user can decide to do it manually.
