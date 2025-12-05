# Migration Fix: ESM/CommonJS Compatibility

## Date
2024-12-05

## Issue
Railway deployment failing with:
```
Error: Can't get migration files: ReferenceError: exports is not defined in ES module scope
This file is being treated as an ES module because it has a '.js' file extension
and '/app/package.json' contains "type": "module". To treat it as a CommonJS script,
rename it to use the '.cjs' file extension.
```

## Root Cause
1. `package.json` has `"type": "module"` → All `.js` files treated as ESM
2. `tsconfig.migrations.json` compiles TypeScript to CommonJS (`"module": "CommonJS"`)
3. Compiled migration uses CommonJS syntax: `Object.defineProperty(exports, ...)`
4. Node.js sees `.js` extension + ESM mode → tries to parse as ESM
5. ESM context doesn't have `exports` global → ReferenceError

## Solution
**Rename compiled migration files from `.js` to `.cjs` after TypeScript compilation.**

### Implementation
1. Created `scripts/rename-migrations.js` (ESM script)
2. Updated `package.json` build scripts to run rename after compilation:
   ```json
   "build": "tsc && tsc -p tsconfig.migrations.json && node scripts/rename-migrations.js",
   "build:migrations": "tsc -p tsconfig.migrations.json && node scripts/rename-migrations.js"
   ```
3. Updated Dockerfile cache bust and added documentation comments

### Why This Works
- `.cjs` extension explicitly marks files as CommonJS modules
- CommonJS modules with `.cjs` work in ESM packages (Node.js interop)
- node-pg-migrate uses `require(filePath)` which respects extensions
- `.cjs` files are never interpreted as ESM, avoiding the conflict

### Files Changed
- `package.json` - Updated build scripts
- `scripts/rename-migrations.js` - New post-build script (ESM)
- `scripts/README.md` - Documentation of the fix
- `Dockerfile` - Updated cache bust + comments
- `MIGRATION_FIX.md` - This document

### Testing
```bash
# Clean build
rm -rf dist && npm run build
# Output: Renamed: 001_create_whatsapp_handler_schema.js -> 001_create_whatsapp_handler_schema.cjs

# Verify .cjs files exist
ls -la dist/migrations/
# Output: 001_create_whatsapp_handler_schema.cjs

# Test require() loading
node -e "const m = require('./dist/migrations/001_create_whatsapp_handler_schema.cjs'); console.log('✓', typeof m.up, typeof m.down);"
# Output: ✓ function function

# Run tests (386 passed, smoke tests expected to fail without running service)
npm test
# Result: 30/32 test files passed
```

### Alternatives Considered

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **Change tsconfig to ESM** | No rename needed | node-pg-migrate v6.2.2 doesn't support ESM migrations | ❌ Blocked |
| **Separate package.json in dist/migrations** | Isolates CJS context | Complex, breaks build cache | ❌ Too complex |
| **Upgrade node-pg-migrate** | Might support ESM | v8+ still uses require(), breaking changes | ❌ Risky |
| **Remove "type": "module"** | No conflict | Breaks main app ESM code | ❌ Breaks app |
| **Rename to .cjs (chosen)** | Simple, explicit, maintainable | Requires post-build script | ✅ **Best** |

### Deployment Checklist
- [x] Local build successful
- [x] Migration files renamed to .cjs
- [x] require() loading verified
- [x] Unit tests passing (30/32 files)
- [x] Dockerfile updated
- [x] Documentation complete
- [ ] Committed to Git
- [ ] Pushed to Railway
- [ ] Railway deployment verified
- [ ] Smoke tests passing in production

### Railway Deployment Notes
When pushed to Railway:
1. Dockerfile builds with `npm run build`
2. Build script compiles TypeScript and renames migrations
3. Production stage copies `dist/` including `.cjs` files
4. CMD runs `npm run migrate:up` which uses `node-pg-migrate`
5. node-pg-migrate finds and requires `.cjs` files successfully
6. Migrations run, service starts

### Rollback Plan
If this fix fails:
1. Revert commit: `git revert HEAD`
2. Railway auto-deploys previous version
3. Investigate alternative approaches (possibly upgrade node-pg-migrate)

### ADR Compliance
- **ADR-002**: TypeScript codebase with ESM modules ✓
- **ADR-003**: node-pg-migrate for migrations ✓
- **ADR-005**: Railway native deployment ✓
- **ADR-014**: TDD workflow (tests passing) ✓

### References
- Node.js Package Docs: https://nodejs.org/api/packages.html#packages_determining_module_system
- node-pg-migrate v6.2.2: https://github.com/salsita/node-pg-migrate
- Railway PostgreSQL: https://docs.railway.app/databases/postgresql
- Issue Thread: Railway deployment ESM/CommonJS conflict

### Next Steps
1. Commit these changes with message: "fix: Resolve ESM/CommonJS conflict for migrations by renaming to .cjs"
2. Push to Railway
3. Monitor deployment logs
4. Run smoke tests post-deployment
5. Update Notion Technical Debt Register if any shortcuts remain
