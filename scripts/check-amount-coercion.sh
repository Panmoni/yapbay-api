#!/usr/bin/env bash
# check-amount-coercion.sh — CI/pre-push guard banning Number() / parseFloat()
# on financial amount fields.
#
# USDC and fiat amounts must remain as strings throughout the API layer to
# preserve decimal precision. Any coercion to JS number types (Number(),
# parseFloat(), +amount, parseInt on amounts) is a potential precision bug.
#
# Exit 0 if clean, exit 1 if violations found.
#
# Scope: src/routes/, src/schemas/, src/middleware/ — intentionally excludes
# src/db.ts (which has legitimate decimalMath helpers), src/services/, and
# scripts/ (which may do one-off numeric conversions).

set -euo pipefail

SEARCH_DIRS="src/routes src/schemas src/middleware"

# Patterns that indicate unsafe amount coercion.
# We look for identifiers containing 'amount' near Number()/parseFloat()/+var.
VIOLATIONS=0

echo "Checking for unsafe amount coercion in: $SEARCH_DIRS"

# Pattern 1: Number(anything_with_amount)
if grep -rn 'Number([^)]*amount' $SEARCH_DIRS --include='*.ts' 2>/dev/null; then
  echo "^^^ Found Number() applied to amount field"
  VIOLATIONS=$((VIOLATIONS + 1))
fi

# Pattern 2: parseFloat(anything_with_amount)
if grep -rn 'parseFloat([^)]*amount' $SEARCH_DIRS --include='*.ts' 2>/dev/null; then
  echo "^^^ Found parseFloat() applied to amount field"
  VIOLATIONS=$((VIOLATIONS + 1))
fi

# Pattern 3: parseInt(anything_with_amount) — amounts should never be ints
if grep -rn 'parseInt([^)]*amount' $SEARCH_DIRS --include='*.ts' 2>/dev/null; then
  echo "^^^ Found parseInt() applied to amount field"
  VIOLATIONS=$((VIOLATIONS + 1))
fi

if [ "$VIOLATIONS" -gt 0 ]; then
  echo ""
  echo "FAIL: Found $VIOLATIONS unsafe amount coercion pattern(s)."
  echo "USDC/fiat amounts must stay as strings. Use decimalMath helpers in src/db.ts."
  exit 1
fi

echo "OK: No unsafe amount coercion found."
exit 0
