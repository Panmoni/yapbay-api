Run a comprehensive dependency security audit and provide actionable recommendations. $ARGUMENTS

## Workflow

1. **Run `bash scripts/security/audit-deps.sh`** to get the current vulnerability report
2. **For each remaining vulnerability** (not auto-fixable):
   - Read the advisory link and assess real-world exploitability in this project
   - Trace the dependency chain with `npm ls <package>`
   - Check if newer versions of parent packages have dropped the vulnerable dep: `npm view <parent>@latest dependencies`
   - Check if the vulnerable package itself has a patched version: `npm view <package> versions --json`
   - Search the web for the CVE/GHSA to check fix status
3. **Classify each vulnerability** into one of:
   - **Fix now**: Safe update available (non-breaking), apply it
   - **Fix via override**: No parent update, but can pin a patched transitive dep via `overrides` in package.json
   - **Fix via parent update**: Parent package has a newer version that drops the vuln dep — recommend updating
   - **Accept risk**: No fix available upstream, exploitability is low for our usage, document the decision
   - **Monitor**: No fix yet, but the vulnerability is relevant — flag for follow-up
4. **Apply safe fixes** by running `npm audit fix` (never `--force` without explicit user approval)
5. **Propose package.json changes** (overrides, version bumps) as separate actions the user can review
6. **Summarize findings** in a clear table format

## Rules

- NEVER run `npm audit fix --force` without asking the user first
- NEVER modify package.json without showing the user the exact change and getting approval
- Always check that the app still builds after any fix: `npm run build`
- If recommending an override, verify the patched version exists and is compatible
- When accepting risk, document the rationale clearly
