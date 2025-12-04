#!/bin/bash
# Smoke Tests for whatsapp-handler Service (ADR-010)
# Run after Railway deployment to verify critical paths

set -e

# Configuration
SERVICE_URL="${1:-https://whatsapp-handler-production.railway.app}"
EXPECTED_SERVICE_NAME="whatsapp-handler"

echo "=========================================="
echo "whatsapp-handler Smoke Tests"
echo "=========================================="
echo "Service URL: $SERVICE_URL"
echo ""

# Test 1: Health Check Endpoint (ADR-008)
echo "[TEST 1] Health Check Endpoint"
HEALTH_RESPONSE=$(curl -s -w "\n%{http_code}" "$SERVICE_URL/health")
HEALTH_STATUS=$(echo "$HEALTH_RESPONSE" | tail -n 1)
HEALTH_BODY=$(echo "$HEALTH_RESPONSE" | head -n -1)

if [ "$HEALTH_STATUS" -eq 200 ]; then
  echo "✅ PASS - Health endpoint returned 200"
  echo "   Response: $HEALTH_BODY"
else
  echo "❌ FAIL - Health endpoint returned $HEALTH_STATUS"
  echo "   Expected: 200"
  exit 1
fi

# Verify health response contains expected fields
if echo "$HEALTH_BODY" | grep -q "\"status\":\"healthy\""; then
  echo "✅ PASS - Health status is 'healthy'"
else
  echo "❌ FAIL - Health status is not 'healthy'"
  exit 1
fi

if echo "$HEALTH_BODY" | grep -q "\"service\":\"$EXPECTED_SERVICE_NAME\""; then
  echo "✅ PASS - Service name matches '$EXPECTED_SERVICE_NAME'"
else
  echo "❌ FAIL - Service name does not match"
  exit 1
fi

echo ""

# Test 2: Readiness Check Endpoint
echo "[TEST 2] Readiness Check Endpoint"
READY_RESPONSE=$(curl -s -w "\n%{http_code}" "$SERVICE_URL/ready")
READY_STATUS=$(echo "$READY_RESPONSE" | tail -n 1)

if [ "$READY_STATUS" -eq 200 ]; then
  echo "✅ PASS - Readiness endpoint returned 200"
else
  echo "❌ FAIL - Readiness endpoint returned $READY_STATUS"
  exit 1
fi

echo ""

# Test 3: Root Endpoint
echo "[TEST 3] Root Endpoint"
ROOT_RESPONSE=$(curl -s -w "\n%{http_code}" "$SERVICE_URL/")
ROOT_STATUS=$(echo "$ROOT_RESPONSE" | tail -n 1)

if [ "$ROOT_STATUS" -eq 200 ]; then
  echo "✅ PASS - Root endpoint returned 200"
else
  echo "❌ FAIL - Root endpoint returned $ROOT_STATUS"
  exit 1
fi

echo ""

# Test 4: Webhook Endpoint (Placeholder)
echo "[TEST 4] Twilio Webhook Endpoint (Placeholder)"
WEBHOOK_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$SERVICE_URL/webhook/twilio")
WEBHOOK_STATUS=$(echo "$WEBHOOK_RESPONSE" | tail -n 1)
WEBHOOK_BODY=$(echo "$WEBHOOK_RESPONSE" | head -n -1)

if [ "$WEBHOOK_STATUS" -eq 200 ]; then
  echo "✅ PASS - Webhook endpoint returned 200"
else
  echo "❌ FAIL - Webhook endpoint returned $WEBHOOK_STATUS"
  exit 1
fi

# Verify TwiML response
if echo "$WEBHOOK_BODY" | grep -q "<Response>"; then
  echo "✅ PASS - Webhook returns valid TwiML response"
else
  echo "❌ FAIL - Webhook does not return TwiML"
  exit 1
fi

echo ""

# Test 5: Metrics Endpoint (Prometheus format)
echo "[TEST 5] Metrics Endpoint"
METRICS_RESPONSE=$(curl -s -w "\n%{http_code}" "$SERVICE_URL/metrics")
METRICS_STATUS=$(echo "$METRICS_RESPONSE" | tail -n 1)

if [ "$METRICS_STATUS" -eq 200 ]; then
  echo "✅ PASS - Metrics endpoint returned 200"
else
  echo "❌ FAIL - Metrics endpoint returned $METRICS_STATUS"
  exit 1
fi

echo ""

# Test 6: Invalid Route (404)
echo "[TEST 6] Invalid Route Returns 404"
NOT_FOUND_RESPONSE=$(curl -s -w "\n%{http_code}" "$SERVICE_URL/invalid-route")
NOT_FOUND_STATUS=$(echo "$NOT_FOUND_RESPONSE" | tail -n 1)

if [ "$NOT_FOUND_STATUS" -eq 404 ]; then
  echo "✅ PASS - Invalid route returns 404"
else
  echo "❌ FAIL - Invalid route returned $NOT_FOUND_STATUS (expected 404)"
  exit 1
fi

echo ""
echo "=========================================="
echo "✅ All Smoke Tests Passed!"
echo "=========================================="
echo ""
echo "Service is healthy and responding correctly."
echo ""

exit 0
