# Bug Condition Exploration Test Results (Task 1)

## Test Execution Date
Test run on UNFIXED code (backend/document_service/feasibility.py)

## Test Status: ✗ ALL TESTS FAILING (Expected - Bug Confirmed)

These tests **MUST FAIL** on unfixed code to confirm the bug exists. After implementing the fix (Task 3), these same tests should **PASS** to confirm the fix works.

## Documented Counterexamples

### 1. Primary Rate Limit (HTTP 429) - No Fallback

**Test**: `test_primary_rate_limit_should_trigger_fallback`
**Input**: Primary model `openai/gpt-oss-120b` returns HTTP 429 (rate limit exceeded)

**Expected Behavior** (after fix):
- System automatically retries with secondary model `qwen/qwen3.8-27b`
- Multiple API calls made (minimum 2)
- Transparent fallback without user intervention

**Actual Behavior** (unfixed code):
- RuntimeError raised: "Groq rate limit reached for feasibility. Otto chat uses a separate provider; retry later."
- Only **1 API call** made to primary model
- No attempt to call secondary or tertiary models
- **BUG CONFIRMED**: No fallback mechanism present

**Validation**: Requirements 2.1

---

### 2. Primary Server Error (HTTP 5xx) - No Fallback

**Test**: `test_primary_server_error_should_trigger_fallback`
**Input**: Primary model returns HTTP 503 (service unavailable)

**Expected Behavior** (after fix):
- System automatically retries with secondary model
- Multiple API calls made

**Actual Behavior** (unfixed code):
- RuntimeError raised: "Groq feasibility request failed (HTTP 503). Check the configured model and retry."
- Only **1 API call** made
- No fallback on server errors
- **BUG CONFIRMED**: Server errors not treated as retriable

**Validation**: Requirements 2.4

---

### 3. Model Cascade Exhaustion - No Cascade Implemented

**Test**: `test_cascade_exhaustion_all_models_should_be_tried`
**Input**: All models return HTTP 429

**Expected Behavior** (after fix):
- System tries all 3 models in order: primary → secondary → tertiary
- Total of **3 API calls** made before final failure
- Clear error message indicating all models were rate-limited

**Actual Behavior** (unfixed code):
- Only **1 API call** made
- System fails immediately on first 429
- **BUG CONFIRMED**: No model cascade exists

**Validation**: Requirements 2.2, 2.5, 2.3, 2.6

---

### 4. Secondary Model Success - Not Attempted

**Test**: `test_secondary_success_after_primary_failure`
**Input**: Primary returns 429, secondary would return 200 (success)

**Expected Behavior** (after fix):
- Primary model fails with 429
- System automatically tries secondary model
- Secondary succeeds, returns valid feasibility report
- Total of **2 API calls**

**Actual Behavior** (unfixed code):
- RuntimeError raised after **1 API call**
- Secondary model never attempted
- User receives error instead of successful result from alternative model
- **BUG CONFIRMED**: Fallback would have succeeded but was never tried

**Validation**: Requirements 2.1, 2.4

---

### 5. Logging Infrastructure - Absent

**Test**: `test_logging_of_model_attempts_should_exist`
**Input**: Primary model fails with 429

**Expected Behavior** (after fix):
- Logs contain: "Attempting feasibility with model: openai/gpt-oss-120b"
- Logs contain fallback warnings: "Model failed with HTTP 429, trying next model"
- Logs contain final success/failure status

**Actual Behavior** (unfixed code):
- No logging output captured
- No indication in logs of which model was attempted
- No observability into fallback behavior
- **BUG CONFIRMED**: No logging infrastructure for model attempts

**Validation**: Requirements 2.7, 2.8, 2.9

---

### 6. Mixed Error Types - Inconsistent Handling

**Test**: `test_mixed_error_types_should_all_trigger_fallback`
**Input**: Primary returns 429, secondary returns 503, tertiary returns 500

**Expected Behavior** (after fix):
- All retriable error codes (429, 5xx) trigger fallback uniformly
- System tries all **3 models**
- Consistent retry logic regardless of specific error code

**Actual Behavior** (unfixed code):
- Only **1 API call** made
- No distinction between retriable/non-retriable errors
- **BUG CONFIRMED**: No unified retry logic for retriable errors

**Validation**: Requirements 2.1, 2.2, 2.4, 2.5

---

## Summary of Bugs Detected

1. **No Retry Loop**: The `assess()` function raises RuntimeError immediately upon receiving 429 or 5xx status codes
2. **Single Model Configuration**: No mechanism to iterate through fallback models
3. **Insufficient Error Classification**: No distinction between retriable (429, 5xx) and non-retriable errors (401, 403)
4. **No Observability**: No logging of model attempts, successes, or failures
5. **User Impact**: Users must manually retry during rate limits even when alternative models are available

## Root Cause Analysis

From code inspection (`backend/document_service/feasibility.py`, lines 136-175):
- `_config()` function returns single model string (line 72)
- `assess()` function makes one API call (line 147)
- Error handling immediately raises RuntimeError for 429 (line 165) and 4xx/5xx (line 169)
- No loop or retry logic present
- No logging statements for model usage

## Next Steps (Task 2 & 3)

1. **Task 2**: Write preservation tests to ensure non-buggy inputs remain unchanged
   - Successful primary model responses
   - Non-retriable errors (401, 403, timeouts, network errors)
   - Request payload structure preservation

2. **Task 3**: Implement the fix
   - Add MODEL_CASCADE constant
   - Update _config() to return list of models
   - Add logging infrastructure
   - Implement retry loop in assess()
   - Enhance error messages for cascade exhaustion

3. **Verification**: Re-run this same test suite after fix implementation
   - All tests should **PASS** on fixed code
   - Preservation tests should continue to **PASS**

## Test File Locations

- Main test suite: `backend/document_tests/test_bugfix_exploration.py`
- Inline validation: `backend/test_inline.py`
- This documentation: `backend/document_tests/BUGFIX_EXPLORATION_RESULTS.md`
