# Implementation Plan

## Overview

This implementation plan follows the exploratory bugfix workflow for adding automatic model fallback to the feasibility service. The workflow ensures systematic validation through exploration tests (written BEFORE the fix to understand the bug), preservation tests (to verify existing behavior remains unchanged), and implementation with specification references.

## Tasks

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Retriable Errors Trigger Immediate Failure Without Fallback
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the unfixed code fails immediately on retriable errors (HTTP 429, 5xx) without attempting fallback models
  - **Scoped PBT Approach**: Scope the property to concrete failing cases - primary model returns 429 or 5xx status codes
  - Test implementation details from Bug Condition in design:
    - Mock primary model `openai/gpt-oss-120b` to return HTTP 429 (rate limit)
    - Mock primary model to return HTTP 503 (server error)
    - Verify unfixed code raises RuntimeError immediately
    - Verify unfixed code does NOT attempt secondary model `qwen/qwen3.8-27b`
    - Verify unfixed code does NOT attempt tertiary model `openai/gpt-oss-20b`
    - Document counterexamples: immediate failure messages without fallback attempts
  - The test assertions should match the Expected Behavior Properties from design:
    - For retriable errors (429, 5xx), system SHOULD automatically retry with secondary/tertiary models
    - System SHOULD log model attempts and failures
    - System SHOULD exhaust all three models before final failure
  - Run test on UNFIXED code (backend/document_service/feasibility.py)
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found:
    - "Groq rate limit reached" error on HTTP 429 without fallback
    - "Groq feasibility request failed (HTTP 503)" error on 5xx without fallback
    - No logging of model attempts in unfixed code
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Successful Calls and Non-Retriable Errors Remain Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-buggy inputs:
    - Successful primary model calls (HTTP 2xx responses)
    - Authentication errors (HTTP 401, 403)
    - Timeout exceptions (httpx.TimeoutException)
    - Network errors (httpx.RequestError)
    - Invalid response format errors (JSON parsing failures)
  - Write property-based tests capturing observed behavior patterns from Preservation Requirements:
    - For successful primary calls: verify response is returned immediately, no fallback attempted
    - For auth errors (401/403): verify RuntimeError is raised with specific message, no fallback attempted
    - For timeout errors: verify "Groq feasibility review timed out" RuntimeError, no fallback
    - For network errors: verify "Cannot reach Groq" RuntimeError, no fallback
    - For invalid JSON responses: verify "Groq returned an invalid feasibility report" RuntimeError, no fallback
    - Verify request payload structure is unchanged (messages, response_format, max_completion_tokens, temperature)
    - Verify semaphore concurrency control (single-slot limit) is unchanged
    - Verify request size limits (MAX_BODY_BYTES, MAX_EVIDENCE_CHARS) are unchanged
  - Property-based testing generates many test cases for stronger guarantees
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15_

- [ ] 3. Fix for automatic model fallback on retriable errors

  - [ ] 3.1 Define model cascade constant
    - Add `MODEL_CASCADE` list constant at module level in feasibility.py
    - Define three-tier fallback sequence: `["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"]`
    - Place constant after MAX_EVIDENCE_CHARS, before SYSTEM message constant
    - _Bug_Condition: isBugCondition(response) where response.status_code == 429 OR (response.status_code >= 500 AND response.status_code <= 599) AND currentModelAttempted != tertiaryModel_
    - _Expected_Behavior: System SHALL automatically retry with next model in cascade (primary → secondary → tertiary)_
    - _Preservation: Successful primary model calls must return results immediately without attempting fallback_
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 3.2 Update _config() function for fallback models
    - Change return type from `tuple[str, str, str]` to `tuple[str, list[str], str]`
    - Replace single model string with list of models
    - Read `FEASIBILITY_GROQ_MODEL` environment variable as primary model
    - Append secondary and tertiary models from MODEL_CASCADE
    - If user configures custom model, use as primary, then fall back to hardcoded secondary/tertiary
    - Preserve existing validation logic for key and base_url
    - _Bug_Condition: No fallback models configured in original code_
    - _Expected_Behavior: Configuration SHALL provide ordered list of fallback models_
    - _Preservation: Configuration loading must continue reading the same environment variables with the same defaults_
    - _Requirements: 2.1, 2.2, 3.14_

  - [ ] 3.3 Add logging infrastructure
    - Import `logging` module at top of feasibility.py
    - Add `logger = logging.getLogger(__name__)` below imports
    - Configure logging for model attempt tracking
    - Log at INFO level for successful model usage
    - Log at WARNING level for retriable failures (429, 5xx)
    - _Bug_Condition: No observability of which model was attempted or why it failed_
    - _Expected_Behavior: System SHALL log model attempts, successes, and retriable failures_
    - _Preservation: No impact on existing functionality, only adds observability_
    - _Requirements: 2.6_

  - [ ] 3.4 Implement retry loop in assess() function
    - Replace single API call with for loop iterating through models from _config()
    - Move existing `client.post()` call inside loop body
    - Add logging before each attempt: `logger.info(f"Attempting feasibility with model: {model}")`
    - On HTTP 2xx success: log success, return result immediately (no fallback)
    - On retriable error (429, 5xx): log warning with status code, continue to next model
    - On non-retriable error (401, 403, timeout, network): raise RuntimeError immediately without fallback
    - Preserve exact request structure (messages, response_format, max_completion_tokens, temperature) for each model attempt
    - _Bug_Condition: Single API call with no retry logic raises RuntimeError immediately on 429/5xx_
    - _Expected_Behavior: Loop through model cascade, attempting each model until success or exhaustion_
    - _Preservation: Non-retriable errors must continue raising RuntimeError without fallback attempts_
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.11_

  - [ ] 3.5 Enhance error messages for fallback exhaustion
    - Update terminal error messages when all models fail with retriable errors
    - If all models return 429: "All Groq models rate-limited for feasibility. Otto chat uses a separate provider; retry later."
    - If all models return 5xx: "All Groq models unavailable for feasibility (server errors). Check status and retry."
    - Preserve original error messages for non-retriable errors (401, 403, timeout, network, validation)
    - _Bug_Condition: Original error messages don't indicate whether fallback was attempted_
    - _Expected_Behavior: Clear error messages indicating all models were tried and why they failed_
    - _Preservation: Original error messages for non-retriable errors must remain unchanged_
    - _Requirements: 2.5, 3.6, 3.7, 3.8, 3.9, 3.10_

  - [ ] 3.6 Add final model logging
    - When a model succeeds, log which model provided the response
    - Add `logger.info(f"Feasibility completed using model: {model}")` before returning result
    - Include model information in response flow for observability
    - _Bug_Condition: No indication of which model actually provided the final response_
    - _Expected_Behavior: Log successful model for debugging and monitoring_
    - _Preservation: No impact on return values or functionality, only adds logging_
    - _Requirements: 2.6_

  - [ ] 3.7 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Automatic Fallback on Retriable Errors
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - Verify fixed code automatically attempts secondary model when primary returns 429
    - Verify fixed code automatically attempts secondary model when primary returns 5xx
    - Verify fixed code logs model attempts and failures
    - Verify fixed code exhausts all three models before final failure
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ] 3.8 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Retriable Behavior Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - Verify successful primary calls still return immediately without fallback
    - Verify auth errors (401/403) still raise identical RuntimeError without fallback
    - Verify timeout errors still raise identical RuntimeError without fallback
    - Verify network errors still raise identical RuntimeError without fallback
    - Verify invalid JSON errors still raise identical RuntimeError without fallback
    - Verify request payload structure is unchanged for all scenarios
    - Verify semaphore concurrency control remains unchanged
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15_

- [ ] 4. Checkpoint - Ensure all tests pass
  - Run all bug condition exploration tests - verify they now pass (were failing on unfixed code)
  - Run all preservation property tests - verify they still pass (were passing on unfixed code)
  - Verify no regressions in existing test suite
  - Verify logging output is present and informative
  - If any issues arise, document them and ask the user for guidance

## Task Dependency Graph

```
1 (Bug Condition Exploration Test) ──┐
                                     │
2 (Preservation Property Tests) ─────┼──→ 3 (Implementation) ──→ 4 (Checkpoint)
                                     │         │
                                     │         ├──→ 3.1 (Model cascade constant)
                                     │         ├──→ 3.2 (Update _config function)
                                     │         ├──→ 3.3 (Add logging)
                                     │         ├──→ 3.4 (Implement retry loop)
                                     │         ├──→ 3.5 (Enhance error messages)
                                     │         ├──→ 3.6 (Add final model logging)
                                     │         ├──→ 3.7 (Verify bug condition test passes)
                                     │         └──→ 3.8 (Verify preservation tests pass)
                                     │
                                     └─────────────────────────────────────────→
```

```json
{
  "waves": [
    {
      "name": "Exploration and Preservation Testing",
      "tasks": ["1", "2"]
    },
    {
      "name": "Implementation",
      "tasks": ["3"]
    },
    {
      "name": "Final Validation",
      "tasks": ["4"]
    }
  ]
}
```

**Key Dependencies:**
- Task 1 (exploration test) and Task 2 (preservation tests) MUST be completed BEFORE Task 3 (implementation)
- Task 1 must FAIL on unfixed code (confirms bug exists)
- Task 2 must PASS on unfixed code (confirms baseline behavior)
- Task 3 subtasks (3.1-3.6) implement the fix with specification references
- Task 3.7 re-runs Task 1 tests (should now PASS, confirming fix works)
- Task 3.8 re-runs Task 2 tests (should still PASS, confirming no regressions)
- Task 4 is final validation checkpoint

## Notes

- **Exploration Test Strategy**: The bug condition test (Task 1) is written BEFORE implementing the fix. It MUST fail on unfixed code, which confirms the bug exists. After implementation, this same test should pass, validating the fix.

- **Preservation Test Strategy**: The preservation tests (Task 2) use observation-first methodology - observe actual behavior on unfixed code for non-buggy inputs, then write property-based tests capturing that behavior. These tests provide strong guarantees that the fix doesn't introduce regressions.

- **Property-Based Testing**: Both exploration and preservation tests use the **Property N:** format to enable hover status in the IDE. Property 1 is for Bug Condition, Property 2 is for Preservation.

- **Test Execution Order**: 
  1. Write and run exploration test on UNFIXED code → expect FAILURE
  2. Write and run preservation tests on UNFIXED code → expect SUCCESS
  3. Implement the fix (Tasks 3.1-3.6)
  4. Re-run exploration test on FIXED code → expect SUCCESS
  5. Re-run preservation tests on FIXED code → expect SUCCESS

- **Specification References**: Implementation tasks (3.1-3.6) include annotations referencing Bug_Condition, Expected_Behavior, Preservation, and Requirements from the design document. These provide traceability from requirements to implementation.

- **Model Cascade**: The fix implements a three-tier fallback: primary (`openai/gpt-oss-120b`) → secondary (`qwen/qwen3.8-27b`) → tertiary (`openai/gpt-oss-20b`). Only retriable errors (HTTP 429, 5xx) trigger fallback; non-retriable errors (401, 403, timeout, network) fail immediately.

- **Logging for Observability**: The implementation adds comprehensive logging at INFO level (model attempts, successes) and WARNING level (retriable failures) to make fallback behavior observable in production.
