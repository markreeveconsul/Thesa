# Bugfix Requirements Document

## Introduction

The feasibility checker currently uses a single Groq model configured in `FEASIBILITY_GROQ_MODEL` (default: `openai/gpt-oss-120b`). When this model encounters rate limits (HTTP 429) or server errors (5xx), the entire feasibility assessment fails immediately, forcing users to manually retry. This creates a poor user experience, especially during peak usage when rate limits are more likely.

This bugfix implements a model fallback cascade to automatically retry with alternative models when the primary model fails due to transient errors. The fallback sequence uses three Groq models in order of quality: `openai/gpt-oss-120b` (primary) → `qwen/qwen3.8-27b` (secondary) → `openai/gpt-oss-20b` (tertiary). Authentication errors (401/403) are not retried since they indicate configuration issues that require user intervention.

## Bug Analysis

### Current Behavior (Defect)

**1. Rate Limit Failures**

1.1 WHEN the primary model `openai/gpt-oss-120b` returns HTTP 429 (rate limit exceeded) THEN the system immediately fails with error message "Groq rate limit reached for feasibility. Otto chat uses a separate provider; retry later." and does not attempt any alternative models

1.2 WHEN the primary model returns HTTP 429 multiple times in succession THEN each user request fails individually, requiring manual retries with no automatic recovery

**2. Server Error Failures**

1.3 WHEN the primary model returns HTTP 5xx server errors (500, 502, 503, 504) THEN the system immediately fails with error message "Groq feasibility request failed (HTTP {status_code}). Check the configured model and retry." and does not attempt any alternative models

**3. No Observability**

1.4 WHEN any model call succeeds or fails THEN the system does not log which specific model was used, making it impossible to debug or monitor fallback behavior

### Expected Behavior (Correct)

**1. Automatic Fallback on Rate Limits**

2.1 WHEN the primary model `openai/gpt-oss-120b` returns HTTP 429 THEN the system SHALL automatically retry the request using the secondary model `qwen/qwen3.8-27b` without user intervention

2.2 WHEN the secondary model `qwen/qwen3.8-27b` also returns HTTP 429 THEN the system SHALL automatically retry the request using the tertiary model `openai/gpt-oss-20b`

2.3 WHEN the tertiary model `openai/gpt-oss-20b` also returns HTTP 429 THEN the system SHALL fail with an appropriate error message indicating all models are rate-limited

**2. Automatic Fallback on Server Errors**

2.4 WHEN the primary model returns HTTP 5xx errors (500, 502, 503, 504) THEN the system SHALL automatically retry the request using the secondary model `qwen/qwen3.8-27b`

2.5 WHEN the secondary model also returns HTTP 5xx errors THEN the system SHALL automatically retry the request using the tertiary model `openai/gpt-oss-20b`

2.6 WHEN the tertiary model also returns HTTP 5xx errors THEN the system SHALL fail with an appropriate error message indicating all models are unavailable

**3. Model Usage Logging**

2.7 WHEN a model is attempted (primary, secondary, or tertiary) THEN the system SHALL log which model was tried and whether it succeeded or failed

2.8 WHEN a fallback occurs THEN the system SHALL log the reason for fallback (rate limit or server error) and which model is being tried next

2.9 WHEN a request completes successfully THEN the system SHALL log which model ultimately provided the response

**4. No Retry on Authentication Errors**

2.10 WHEN any model returns HTTP 401 or 403 (authentication/authorization errors) THEN the system SHALL immediately fail without attempting fallback, since these indicate configuration problems requiring user intervention

### Unchanged Behavior (Regression Prevention)

**1. Successful Primary Model Calls**

3.1 WHEN the primary model `openai/gpt-oss-120b` succeeds on the first attempt THEN the system SHALL CONTINUE TO return the result without attempting any fallback models

3.2 WHEN the primary model succeeds THEN the system SHALL CONTINUE TO use exactly the same response parsing, validation, and error handling as before

**2. Request Payload Construction**

3.3 WHEN constructing the API request payload THEN the system SHALL CONTINUE TO use the same structure with `student_plan`, `evidence`, `system` message, and `response_format: json_object`

3.4 WHEN sending requests to any model THEN the system SHALL CONTINUE TO use the same API endpoint structure, headers, timeout values (40s client, 45s total), and parameters (max_completion_tokens: 2200, temperature: 0.2)

**3. Response Validation**

3.5 WHEN receiving a response from any model THEN the system SHALL CONTINUE TO validate the JSON structure with the same strict requirements for keys (summary, dimensions, risks, next_steps, scope_adjustments, missing_information)

3.6 WHEN validating response dimensions THEN the system SHALL CONTINUE TO enforce the exact same dimension names (scope, method_fit, access, timeline, resources, ethics) and status values ("Looks workable", "Needs planning", "Needs clarification")

3.7 WHEN invalid response format is received THEN the system SHALL CONTINUE TO raise RuntimeError with message "Groq returned an invalid feasibility report. Please retry."

**4. Error Handling for Non-Retriable Errors**

3.8 WHEN httpx.TimeoutException occurs THEN the system SHALL CONTINUE TO raise RuntimeError with message "Groq feasibility review timed out. Your form is preserved; retry later."

3.9 WHEN httpx.RequestError occurs (network issues) THEN the system SHALL CONTINUE TO raise RuntimeError with message "Cannot reach Groq. Your form is preserved; check the connection and retry."

3.10 WHEN authentication errors (401, 403) occur THEN the system SHALL CONTINUE TO raise RuntimeError with message "Groq rejected the feasibility API key or access." without retry attempts

**5. Concurrency and Resource Limits**

3.11 WHEN multiple feasibility requests arrive concurrently THEN the system SHALL CONTINUE TO enforce the single-slot semaphore limit, allowing only one feasibility review at a time

3.12 WHEN request body exceeds MAX_BODY_BYTES (180,000) THEN the system SHALL CONTINUE TO raise HTTPException 413 with message "Feasibility request is too large. Reduce the form or source excerpts."

3.13 WHEN evidence text exceeds MAX_EVIDENCE_CHARS (12,000) THEN the system SHALL CONTINUE TO raise ValueError during validation

**6. Configuration Loading**

3.14 WHEN loading configuration via `_config()` THEN the system SHALL CONTINUE TO read `FEASIBILITY_GROQ_API_KEY`, `FEASIBILITY_GROQ_MODEL`, and `FEASIBILITY_GROQ_BASE_URL` from environment variables with the same defaults and validation

3.15 WHEN `FEASIBILITY_GROQ_API_KEY` is missing or empty THEN the system SHALL CONTINUE TO raise RuntimeError with message "Add your Groq key to FEASIBILITY_GROQ_API_KEY in backend/.env."
