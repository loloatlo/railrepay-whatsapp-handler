# Test Fixtures - Journey Eligibility Handler

**Owner**: Jessie QA (per ADR-017)
**Purpose**: Provide realistic test data for journey eligibility scenarios

---

## Fixture Directory Structure

```
tests/fixtures/
├── api/                              # External service mock responses
│   ├── eligibility-engine-responses.json
│   └── delay-tracker-responses.json
├── messages/                         # WhatsApp message payloads
└── db/                              # Database seed data
```

---

## Using Fixtures in Tests

### Test Data Pattern

Each test scenario provides complete context data via `HandlerContext`:

```typescript
const testContext: HandlerContext = {
  phoneNumber: '+447700900123',
  messageBody: 'SKIP',
  messageSid: 'SM123',
  user: mockUser,
  currentState: FSMState.AWAITING_TICKET_UPLOAD,
  correlationId: 'test-corr-id',

  // Journey details that differentiate scenarios
  stateData: {
    journeyId: 'journey-123',
    travelDate: '2024-11-19',  // Historic vs future
    origin: 'PAD',
    destination: 'CDF',
    departureTime: '10:00',
  },

  // Mock service responses (Blake implements mocking mechanism)
  mockEligibilityResponse: {
    eligible: true,
    delayMinutes: 45,
    compensationAmount: '£15.00',
    compensationPercentage: 25,
  },
};
```

### Scenario Differentiation

Tests differentiate scenarios by:

1. **Journey Date**: `travelDate` determines historic vs future
   - Historic: `'2024-11-19'` (past)
   - Future: `'2024-11-21'` (future)

2. **Eligibility Response**: `mockEligibilityResponse` determines outcome
   - Eligible: `{ eligible: true, delayMinutes: 45, ... }`
   - Ineligible: `{ eligible: false, delayMinutes: 10, ... }`
   - No data: `{ eligible: null, delayDataAvailable: false }`
   - Service down: `{ serviceUnavailable: true }`

3. **Tracking Response**: `mockDelayTrackerResponse` for future journeys
   - Success: `{ registered: true, trackingId: 'track-123' }`
   - Service down: `{ serviceUnavailable: true }`

---

## Blake's Implementation Notes

### Mocking Strategy

**Blake must implement:**

1. **Service Client Mocks**: Mock HTTP clients for eligibility-engine and delay-tracker

   ```typescript
   // Example: Mock eligibility-engine client
   const mockEligibilityClient = {
     evaluate: vi.fn((journey) => {
       // Return mockEligibilityResponse from test context
       return Promise.resolve(context.mockEligibilityResponse);
     })
   };
   ```

2. **Date-Based Routing**: Handler determines historic vs future based on `travelDate`

   ```typescript
   const isHistoric = new Date(stateData.travelDate) < new Date();

   if (isHistoric) {
     // Call eligibility-engine
     const result = await eligibilityClient.evaluate(journey);
   } else {
     // Call delay-tracker
     const result = await delayTrackerClient.register(journey);
   }
   ```

3. **Error Handling**: Check for `serviceUnavailable` flag in mock responses

   ```typescript
   if (eligibilityResponse.serviceUnavailable) {
     return {
       response: 'We'll check your eligibility later...',
       stateData: { eligibilityCheckPending: true },
       nextState: FSMState.AUTHENTICATED,
     };
   }
   ```

---

## Fixture Update Process

**When new scenarios are needed:**

1. Jessie creates new fixture file or adds to existing
2. Jessie documents fixture in this README
3. Blake uses fixture patterns in implementation
4. **Test Lock Rule**: Blake MUST NOT modify Jessie's test fixtures

---

## Fixture Quality Standards

Per ADR-017, all fixtures MUST include:

- ✅ Happy path (success scenario)
- ✅ Validation failure (bad input)
- ✅ Empty/null values (edge cases)
- ✅ Boundary values (15-minute threshold)
- ✅ Service unavailable (error handling)

---

## References

- **ADR-017**: Test Fixture Ownership
- **Testing Strategy 2.0**: Section 10 - Test Data Management
- **CLAUDE.md**: Fixture ownership rules
