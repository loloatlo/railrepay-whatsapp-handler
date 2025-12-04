-- Manual Migration Verification Script
-- Run this after: npm run migrate:up
--
-- Usage:
--   psql $DATABASE_URL -f scripts/verify-migration.sql

\echo '=== Verifying whatsapp_handler Schema Migration ==='
\echo ''

-- 1. Verify schema exists
\echo '1. Checking schema exists...'
SELECT
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.schemata WHERE schema_name = 'whatsapp_handler'
    )
    THEN '✅ Schema whatsapp_handler exists'
    ELSE '❌ Schema whatsapp_handler NOT FOUND'
  END AS status;

\echo ''

-- 2. Verify tables exist
\echo '2. Checking tables exist...'
SELECT
  tablename,
  CASE
    WHEN tablename IN ('users', 'user_preferences', 'outbox_events')
    THEN '✅'
    ELSE '⚠️'
  END AS status
FROM pg_tables
WHERE schemaname = 'whatsapp_handler'
ORDER BY tablename;

\echo ''

-- 3. Verify users table structure
\echo '3. Checking users table columns...'
SELECT
  column_name,
  data_type,
  is_nullable,
  CASE
    WHEN column_default IS NOT NULL THEN 'DEFAULT'
    ELSE ''
  END AS has_default
FROM information_schema.columns
WHERE table_schema = 'whatsapp_handler'
  AND table_name = 'users'
ORDER BY ordinal_position;

\echo ''

-- 4. Verify indexes
\echo '4. Checking indexes...'
SELECT
  indexname,
  CASE
    WHEN indexname LIKE 'idx_%' THEN '✅'
    WHEN indexname LIKE '%_pkey' THEN '🔑 Primary Key'
    ELSE '⚠️'
  END AS type
FROM pg_indexes
WHERE schemaname = 'whatsapp_handler'
ORDER BY tablename, indexname;

\echo ''

-- 5. Verify constraints
\echo '5. Checking constraints...'
SELECT
  conname AS constraint_name,
  CASE contype
    WHEN 'p' THEN '🔑 PRIMARY KEY'
    WHEN 'f' THEN '🔗 FOREIGN KEY'
    WHEN 'u' THEN '🔒 UNIQUE'
    WHEN 'c' THEN '✓ CHECK'
    ELSE contype::text
  END AS constraint_type,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE connamespace = 'whatsapp_handler'::regnamespace
ORDER BY conrelid::regclass::text, contype;

\echo ''

-- 6. Verify foreign key relationships
\echo '6. Checking foreign key relationships...'
SELECT
  tc.table_name AS from_table,
  kcu.column_name AS from_column,
  ccu.table_name AS to_table,
  ccu.column_name AS to_column,
  rc.delete_rule
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
JOIN information_schema.referential_constraints AS rc
  ON rc.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'whatsapp_handler';

\echo ''

-- 7. Test data insertion and constraints
\echo '7. Testing constraints with sample data...'
\echo 'Inserting test user...'
INSERT INTO whatsapp_handler.users (phone_number, registered_at)
VALUES ('+447700900123', NOW())
ON CONFLICT (phone_number) DO NOTHING
RETURNING id, phone_number, registered_at;

\echo ''
\echo 'Testing unique constraint (should fail if run twice)...'
-- This will fail on second run (expected)
-- INSERT INTO whatsapp_handler.users (phone_number, registered_at)
-- VALUES ('+447700900123', NOW());

\echo '8. Testing cascade delete...'
DO $$
DECLARE
  test_user_id UUID;
BEGIN
  -- Insert test user
  INSERT INTO whatsapp_handler.users (phone_number, registered_at)
  VALUES ('+447700900999', NOW())
  RETURNING id INTO test_user_id;

  -- Insert preferences
  INSERT INTO whatsapp_handler.user_preferences (user_id)
  VALUES (test_user_id);

  -- Verify preference exists
  IF EXISTS (SELECT 1 FROM whatsapp_handler.user_preferences WHERE user_id = test_user_id) THEN
    RAISE NOTICE '✅ Preference inserted';
  END IF;

  -- Delete user (should cascade)
  DELETE FROM whatsapp_handler.users WHERE id = test_user_id;

  -- Verify preference deleted
  IF NOT EXISTS (SELECT 1 FROM whatsapp_handler.user_preferences WHERE user_id = test_user_id) THEN
    RAISE NOTICE '✅ CASCADE DELETE working correctly';
  ELSE
    RAISE NOTICE '❌ CASCADE DELETE failed';
  END IF;
END $$;

\echo ''

-- 9. Summary
\echo '=== Migration Verification Complete ==='
\echo ''
\echo 'Expected Results:'
\echo '  - Schema: whatsapp_handler (✅)'
\echo '  - Tables: 3 (users, user_preferences, outbox_events)'
\echo '  - Indexes: 7 (including partial indexes)'
\echo '  - Foreign Keys: 1 (user_preferences.user_id → users.id)'
\echo '  - Cascade Delete: Working (✅)'
\echo ''
\echo 'To rollback migration: npm run migrate:down'
\echo ''
