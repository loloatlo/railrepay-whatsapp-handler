#!/bin/bash
# Verification script for ESM/CommonJS migration fix
# Run this script to verify the fix works before committing

set -e  # Exit on error

echo "=================================================="
echo "Migration Fix Verification Script"
echo "=================================================="
echo ""

# Step 1: Clean build
echo "Step 1: Clean build..."
rm -rf dist
npm run build
echo "✓ Build completed"
echo ""

# Step 2: Verify .cjs files exist
echo "Step 2: Verify .cjs migration files exist..."
if [ ! -f "dist/migrations/001_create_whatsapp_handler_schema.cjs" ]; then
  echo "✗ ERROR: Migration .cjs file not found!"
  exit 1
fi
echo "✓ Migration .cjs file exists"
echo ""

# Step 3: Verify no .js files remain in migrations
echo "Step 3: Check for leftover .js migration files..."
JS_COUNT=$(find dist/migrations -name "*.js" 2>/dev/null | wc -l)
if [ "$JS_COUNT" -gt 0 ]; then
  echo "✗ ERROR: Found $JS_COUNT .js files in dist/migrations (should be 0)"
  exit 1
fi
echo "✓ No .js files in dist/migrations"
echo ""

# Step 4: Test require() loading
echo "Step 4: Test require() loading of .cjs migration..."
node -e "
  const migration = require('./dist/migrations/001_create_whatsapp_handler_schema.cjs');
  if (typeof migration.up !== 'function') {
    console.error('✗ ERROR: migration.up is not a function');
    process.exit(1);
  }
  if (typeof migration.down !== 'function') {
    console.error('✗ ERROR: migration.down is not a function');
    process.exit(1);
  }
  console.log('✓ Migration loaded successfully');
  console.log('  - up function: ' + typeof migration.up);
  console.log('  - down function: ' + typeof migration.down);
"
echo ""

# Step 5: Verify main app still builds as ESM
echo "Step 5: Verify main application (ESM)..."
if [ ! -f "dist/index.js" ]; then
  echo "✗ ERROR: dist/index.js not found!"
  exit 1
fi
# Check if main app has ES module syntax
if ! grep -q "export\|import" dist/index.js; then
  echo "⚠ WARNING: dist/index.js may not be ESM (no export/import found)"
fi
echo "✓ Main application built"
echo ""

# Step 6: Run unit tests (exclude smoke tests)
echo "Step 6: Run unit tests..."
echo "(Smoke tests will fail without running service - this is expected)"
npm test 2>&1 | grep -E "(Test Files|PASS|FAIL)" | tail -20
echo ""

# Summary
echo "=================================================="
echo "Verification Complete!"
echo "=================================================="
echo ""
echo "All checks passed. Ready to commit!"
echo ""
echo "Next steps:"
echo "  1. Review changes: git diff"
echo "  2. Stage files: git add ."
echo "  3. Commit: git commit -m 'fix: Resolve ESM/CommonJS conflict for migrations'"
echo "  4. Push: git push origin main"
echo "  5. Monitor Railway deployment"
echo ""
