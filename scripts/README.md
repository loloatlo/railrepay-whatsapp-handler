# Build Scripts

## rename-migrations.js

### Purpose
Resolves ESM/CommonJS compatibility conflict for database migrations in Railway production deployments.

### Problem
1. **package.json** declares `"type": "module"` - treats all `.js` files as ES Modules
2. **Migrations** are compiled to CommonJS by `tsconfig.migrations.json` (required by node-pg-migrate)
3. **Node.js** sees `.js` extension + `"type": "module"` → interprets as ESM
4. **CommonJS code** uses `exports` object which doesn't exist in ESM context
5. **Result**: `ReferenceError: exports is not defined in ES module scope`

### Solution
After TypeScript compilation:
1. Scan `dist/migrations/` directory
2. Rename all `.js` files to `.cjs` extension
3. `.cjs` extension explicitly marks files as CommonJS
4. node-pg-migrate can `require()` them successfully
5. Main application remains ESM

### Why This Works
- CommonJS modules with `.cjs` extension are valid in ESM packages
- node-pg-migrate uses `require(path)` which respects file extensions
- `.cjs` files are never interpreted as ESM, avoiding the exports conflict
- No changes needed to main application code

### Alternatives Considered
1. **Change tsconfig.migrations.json to output ESM** - node-pg-migrate v6.2.2 doesn't support ESM migrations
2. **Create separate package.json in dist/migrations** - Complex, breaks build cache
3. **Use import() instead of require()** - Would require patching node-pg-migrate
4. **Remove "type": "module"** - Would break main application code

### Integration
- **Build**: Runs automatically after `tsc -p tsconfig.migrations.json`
- **Deploy**: Dockerfile runs `npm run build` which includes this script
- **Dev**: Runs on `npm run build:migrations` for local testing

### Maintenance
- Script is idempotent (safe to run multiple times)
- Exits with error code 1 if dist/migrations not found
- Logs each renamed file for debugging

### Testing
```bash
# Clean build
rm -rf dist && npm run build

# Verify .cjs files created
ls -la dist/migrations/

# Test node-pg-migrate can load them
node -e "const m = require('./dist/migrations/001_create_whatsapp_handler_schema.cjs'); console.log('Loaded:', typeof m.up, typeof m.down);"
```

### References
- Issue: Railway deployment failing with "exports is not defined"
- ADR-002: TypeScript codebase with ESM modules
- ADR-003: node-pg-migrate for database migrations
- node-pg-migrate v6.2.2 (CommonJS only)
- Node.js ESM/CommonJS interop: https://nodejs.org/api/packages.html#packages_determining_module_system
