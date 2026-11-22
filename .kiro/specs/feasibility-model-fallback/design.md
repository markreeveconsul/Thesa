# Feasibility Model Fallback Bugfix Design

## Overview

The feasibility service currently fails immediately when the primary Groq model encounters rate limits (HTTP 429) or server errors (5xx). This design implements a three-tier model fallback cascade that automatically retries with alternative models, significantly improving reliability during peak usage. The fallback sequence uses `openai/gpt-oss-120b` (primary) → `qwen/qwen3.8-27b` (secondary) → `openai/gpt-oss-20b` (tertiary), with comprehensive logging for observability. Authentication errors (401/403) are not retried since they indicate configuration issues requiring user intervention.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug - when the primary model returns HTTP 429 (rate limit) or 5xx (server error)
- **Property (P)**: The desired behavior when C holds - the system automatically retries with secondary/tertiary models
- **Preservation**: Successful primary model responses and all non-retriable error handling that must remain unchanged
- **assess()**: The function in `backend/document_service/feasibility.py` (line 136) that handles the Groq API call
- **Retriable Error**: HTTP status codes 429 (rate limit) or 5xx (500-599, server errors) that warrant automatic fallback
- **Non-Retriable Error**: HTTP status codes 401/403 (auth errors), timeouts, network errors, or response validation errors
- **Model Cascade**: The ordered sequence of three Groq models to try: primary → secondary → tertiary

## Bug Details

### Bug Condition

The bug manifests when the primary model encounters transient failures that could be resolved by trying an alternative model. The `assess()` function immediately raises RuntimeError without attempting any fallback, forcing users to manually retry.

**Formal Specification:**
```
FUNCTION isBugCondition(response)
  INPUT: response of type httpx.Response
  OUTPUT: boolean
  
  RETURN (response.status_code == 429)
         OR (response.status_code >= 500 AND response.status_code <= 599)
         AND currentModelAttempted != tertiaryModel
END FUNCTION
```

### Examples

- **Example 1**: User submits feasibility form during peak hours → primary model `openai/gpt-oss-120b` returns HTTP 429 → system raises "Groq rate limit reached" error → user must manually retry → Expected: system automatically tries `qwen/qwen3.8-27b` without user intervention

- **Example 2**: Primary model encounters temporary server error (HTTP 503) → system raises "Groq feasibility request failed (HTTP 503)" → user loses their context → Expected: system automatically tries secondary model

- **Example 3**: Primary model returns 429, secondary also returns 429 → system should try tertiary model `openai/gpt-oss-20b` → Expected: exhaust all three models before failing

- **Edge Case**: All three models return HTTP 429 → Expected: fail with clear error message indicating all models are rate-limited, preserving the original user-facing error format

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Successful primary model calls must return results immediately without attempting fallback
- All request payload construction (student_plan, evidence, system message, response_format) must remain identical
- Response validation logic (_report function) must continue enforcing the same strict JSON structure
- Non-retriable errors (timeouts, network errors, auth errors) must continue raising RuntimeError without fallback attempts
- Concurrency control (single-slot semaphore) must continue limiting to one feasibility review at a time
- Request size limits (MAX_BODY_BYTES, MAX_EVIDENCE_CHARS) must continue enforcing the same thresholds
- Configuration loading (_config function) must continue reading the same environment variables with the same defaults

**Scope:**
All inputs that result in successful primary model responses OR non-retriable errors should be completely unaffected by this fix. This includes:
- Successful API calls (HTTP 2xx responses)
- Authentication failures (HTTP 401/403)
- Timeout exceptions (httpx.TimeoutException)
- Network errors (httpx.RequestError)
- Invalid response format errors (JSON parsing failures)

## Hypothesized Root Cause

Based on the bug description and code analysis, the root cause is:

1. **No Retry Logic**: The `assess()` function (lines 136-175) raises RuntimeError immediately upon receiving 429 or 5xx status codes, with no mechanism to attempt alternative models

2. **Single Model Configuration**: The `_config()` function only reads `FEASIBILITY_GROQ_MODEL` once, providing no way to specify or iterate through fallback models

3. **Insufficient Error Classification**: The error handling code doesn't distinguish between retriable errors (429, 5xx) and non-retriable errors (401, 403, network issues), treating all failures as terminal

4. **No Observability**: The code doesn't log which model was attempted or why it failed, making it impossible to diagnose fallback behavior or rate limit patterns

## Correctness Properties

Property 1: Bug Condition - Automatic Model Fallback on Retriable Errors

_For any_ API response where the status code is 429 (rate limit) or 5xx (server error) and the current model is not the tertiary model, the fixed assess function SHALL automatically retry the request using the next model in the cascade (primary → secondary → tertiary), ultimately returning a valid feasibility report if any model succeeds.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**

Property 2: Preservation - Non-Retriable Error Handling

_For any_ input that results in a successful primary model response (HTTP 2xx) OR a non-retriable error (401, 403, timeout, network error, validation error), the fixed code SHALL produce exactly the same behavior as the original code, raising the same RuntimeError messages without attempting any model fallback.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `backend/document_service/feasibility.py`

**Function**: `assess()` (lines 136-175)

**Specific Changes**:

1. **Define Model Cascade Constant**: Add a module-level constant defining the three-tier fallback sequence
   - Create `MODEL_CASCADE` list containing: `["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"]`
   - Place near other module constants (after MAX_EVIDENCE_CHARS, before SYSTEM)

2. **Modify _config() Function**: Update configuration loading to support fallback models
   - Change return type from `tuple[str, str, str]` to `tuple[str, list[str], str]`
   - Replace single model string with list of models: read `FEASIBILITY_GROQ_MODEL` as primary, then append secondary/tertiary from `MODEL_CASCADE`
   - If user configures a custom model, use it as primary, then fall back to hardcoded secondary/tertiary
   - Preserve existing validation logic for key and base_url

3. **Add Logging Infrastructure**: Import and configure logging for model attempt tracking
   - Import `logging` module at top of file
   - Add `logger = logging.getLogger(__name__)` below imports
   - Log at INFO level for successful model usage, WARNING level for retriable failures

4. **Implement Retry Loop in assess()**: Replace single API call with loop over model cascade
   - Create `for` loop iterating through models from `_config()`
   - Move existing `client.post()` call inside loop body
   - Add logging before each attempt: `logger.info(f"Attempting feasibility with model: {model}")`
   - On success (HTTP 2xx), log success and return immediately
   - On retriable error (429, 5xx), log warning and continue to next model
   - On non-retriable error (401, 403, timeout, network), raise RuntimeError immediately without fallback

5. **Enhance Error Messages for Fallback Exhaustion**: Update terminal error messages when all models fail
   - If all models return 429: "All Groq models rate-limited for feasibility. Otto chat uses a separate provider; retry later."
   - If all models return 5xx: "All Groq models unavailable for feasibility (server errors). Check status and retry."
   - Preserve original error messages for non-retriable errors (unchanged behavior)

6. **Log Final Model Used**: When a model succeeds, log which model provided the response
   - Add `logger.info(f"Feasibility completed using model: {model}")` before returning result
   - Include this information in the response flow for observability

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code (immediate failure on 429/5xx), then verify the fix works correctly (automatic fallback) and preserves existing behavior (no fallback on success or non-retriable errors).

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm that the unfixed code fails immediately on 429/5xx without attempting fallback. If we cannot reproduce the bug, we will need to re-hypothesize.

**Test Plan**: Write tests that mock the Groq API to return specific HTTP status codes (429, 503, 500). Use pytest with `respx` library to mock httpx requests. Run these tests on the UNFIXED code to observe immediate failures without fallback attempts.

**Test Cases**:
1. **Primary Rate Limit Test**: Mock primary model to return HTTP 429 → verify unfixed code raises "Groq rate limit reached" without trying secondary model (will fail on unfixed code, showing bug exists)
2. **Primary Server Error Test**: Mock primary model to return HTTP 503 → verify unfixed code raises "Groq feasibility request failed (HTTP 503)" without trying secondary model (will fail on unfixed code)
3. **Multiple Model Rate Limits Test**: Mock primary and secondary models to return 429 → verify unfixed code never tries tertiary model (will fail on unfixed code)
4. **No Logging Test**: Mock primary model to return 429 → verify unfixed code doesn't log which model was attempted (will fail on unfixed code, no logs present)

**Expected Counterexamples**:
- Immediate RuntimeError when primary model returns 429 or 5xx
- No attempt to call secondary or tertiary models
- No logging of model attempts or failures
- Possible causes: no retry loop, no error classification, no fallback model configuration

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds (retriable errors from primary/secondary models), the fixed function produces the expected behavior (automatic fallback and eventual success).

**Pseudocode:**
```
FOR ALL response WHERE isBugCondition(response) DO
  result := assess_fixed(inputs, evidence, client_with_mocked_responses)
  ASSERT result is valid feasibility report (if any model succeeds)
     OR result raises appropriate "all models failed" error (if all models fail)
  ASSERT secondary model was attempted (if primary fails)
  ASSERT tertiary model was attempted (if primary and secondary fail)
  ASSERT model attempts were logged
END FOR
```

**Test Cases**:
1. **Primary Fails, Secondary Succeeds**: Mock primary → 429, secondary → 200 success → verify secondary model's response is returned
2. **Primary and Secondary Fail, Tertiary Succeeds**: Mock primary → 503, secondary → 500, tertiary → 200 → verify tertiary response returned
3. **All Models Rate Limited**: Mock all three → 429 → verify error message "All Groq models rate-limited"
4. **Mixed Failures**: Mock primary → 429, secondary → 503, tertiary → 200 → verify fallback through different error types works
5. **Logging Verification**: Mock primary → 429, secondary → 200 → verify logs contain both attempt messages and final success message

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold (successful primary response or non-retriable errors), the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(response) DO
  ASSERT assess_original(input) = assess_fixed(input)
  ASSERT no fallback models are attempted
  ASSERT error messages are identical
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain (various valid inputs, various error types)
- It catches edge cases that manual unit tests might miss (unusual evidence configurations, boundary values)
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for successful calls and non-retriable errors, then write property-based tests capturing that exact behavior.

**Test Cases**:
1. **Primary Success Preservation**: Mock primary model → 200 success → verify ONLY primary model is called, no fallback attempts, same response validation
2. **Auth Error Preservation**: Mock primary model → 401 → verify immediate RuntimeError "Groq rejected the feasibility API key or access" without fallback
3. **Auth Error Preservation (403)**: Mock primary model → 403 → verify immediate RuntimeError without fallback
4. **Timeout Preservation**: Mock client to raise httpx.TimeoutException → verify RuntimeError "Groq feasibility review timed out" without fallback
5. **Network Error Preservation**: Mock client to raise httpx.RequestError → verify RuntimeError "Cannot reach Groq" without fallback
6. **Invalid Response Preservation**: Mock primary model → 200 with malformed JSON → verify RuntimeError "Groq returned an invalid feasibility report" without fallback
7. **Payload Construction Preservation**: Verify request JSON structure is identical for all models (same messages, response_format, max_completion_tokens, temperature)
8. **Concurrency Preservation**: Verify semaphore still limits to one concurrent request even with fallback logic

### Unit Tests

- Test each model cascade scenario (primary success, primary fails + secondary success, all fail)
- Test error classification logic (retriable vs non-retriable)
- Test logging output for each scenario
- Test edge case: custom model in environment variable + fallback to hardcoded models
- Test that fallback preserves exact request structure for each model

### Property-Based Tests

- Generate random StudentInputs and Evidence lists, verify successful primary calls never trigger fallback
- Generate random HTTP error codes, verify only 429 and 5xx trigger fallback
- Generate random model configurations, verify fallback cascade always uses correct order
- Test that all non-retriable errors (401, 403, timeouts, network) produce identical errors across many scenarios

### Integration Tests

- Test full feasibility flow with mock Groq API returning rate limits, verify fallback occurs transparently
- Test concurrent requests with rate limits, verify semaphore still enforces single-slot limit
- Test that visual feedback in frontend remains unchanged when fallback occurs (user shouldn't see fallback happening)
- Test configuration loading with various environment variable combinations
