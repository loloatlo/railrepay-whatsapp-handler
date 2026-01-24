# Bug Fix: User Creation in START Handler

## Summary

Fixed bug where START handler never creates user record in database, causing "User required for OTP verification" error in OTP handler.

## Root Cause

The START handler was returning a welcome message for new users (when `ctx.user` is null) but never actually creating a user record in the database. This caused the OTP handler to fail at line 22 with "User required for OTP verification" because `ctx.user` remained null.

## Solution (TDD Approach per ADR-014)

### 1. Tests Written FIRST

**File: `tests/unit/handlers/start.handler.test.ts`**
- Added 4 new tests for user creation behavior
- Test: CREATE user when `ctx.user` is null and `userRepository` provided
- Test: PUBLISH `user.registered` event when creating new user
- Test: NOT create user when `ctx.user` already exists (avoid duplicates)
- Test: Backward compatibility when no `userRepository` provided

**File: `tests/unit/handlers/otp.handler.test.ts`**
- Added 3 new tests for `verified_at` update
- Test: UPDATE `user.verified_at` when OTP is valid
- Test: NOT update when OTP is invalid
- Test: Backward compatibility without `userRepository`

### 2. Implementation

**File: `src/handlers/start.handler.ts`**
- Added optional `userRepository` parameter to handler signature
- When `!ctx.user` AND `userRepository` provided:
  - Create user with `userRepository.create({ phone_number: ctx.phoneNumber })`
  - Publish `user.registered` event to outbox
  - Return welcome message with event in result
- Maintains backward compatibility (works without userRepository)

**File: `src/handlers/otp.handler.ts`**
- Added optional `userRepository` parameter to handler signature
- After successful OTP validation (6-digit code):
  - Update user with `userRepository.update(ctx.user.id, { verified_at: new Date() })`
  - Include `verified_at` timestamp in `user.verified` event
- Maintains backward compatibility

**File: `src/routes/webhook.ts`**
- Pass `userRepository` to handler invocations: `handler(handlerContext, userRepository)`
- Ensures all handlers receive repository instance for database operations

**File: `src/handlers/index.ts`**
- Updated `Handler` type signature to accept optional `userRepository` parameter
- Documents dependency injection pattern

## Test Results

### Before Fix
- 3 tests FAILED (expected behavior - tests written first per TDD)
  - START handler not creating user
  - START handler not publishing event
  - OTP handler not updating verified_at

### After Fix
- All 396 unit tests PASS
- Build compiles without errors
- No regressions in existing functionality

## Architecture Compliance

- **ADR-014**: TDD enforced - tests written BEFORE implementation
- **ADR-002**: Correlation IDs included in all events
- **Schema Isolation**: Uses UserRepository abstraction (no direct SQL in handlers)
- **Event Sourcing**: Publishes domain events (`user.registered`, `user.verified`)
- **Dependency Injection**: userRepository passed as parameter (testable, loosely coupled)

## Event Flow

### New User Registration (Fixed)
1. User sends first WhatsApp message
2. Webhook controller calls START handler with `userRepository`
3. START handler creates user record in `whatsapp_handler.users` table
4. START handler publishes `user.registered` event to outbox
5. User receives welcome message and transitions to AWAITING_TERMS

### OTP Verification (Fixed)
1. User sends valid 6-digit OTP code
2. Webhook controller calls OTP handler with `userRepository`
3. OTP handler validates code format
4. OTP handler updates `user.verified_at` in database
5. OTP handler publishes `user.verified` event to outbox
6. User receives success message and transitions to AUTHENTICATED

## Files Changed

```
src/handlers/start.handler.ts         (implementation)
src/handlers/otp.handler.ts           (implementation)
src/handlers/index.ts                 (type signature)
src/routes/webhook.ts                 (dependency injection)
tests/unit/handlers/start.handler.test.ts  (new tests)
tests/unit/handlers/otp.handler.test.ts    (new tests)
```

## Testing

Run tests:
```bash
npm test -- tests/unit/handlers/start.handler.test.ts
npm test -- tests/unit/handlers/otp.handler.test.ts
npm test -- tests/unit/  # All unit tests
npm run build            # TypeScript compilation
```

## Migration Notes

- No database migration required (schema already supports these operations)
- No environment variable changes required
- Backward compatible (handlers work without userRepository for testing)
- No breaking changes to handler contracts

## Technical Debt

None recorded - implementation follows all ADRs and best practices.

## Ready for Phase 4

This implementation is ready to hand off to Jessie for QA verification per the Standard Operating Procedures.
