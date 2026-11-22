"""
Bug Condition Exploration Test for Feasibility Model Fallback (Task 1)

**Property 1: Bug Condition** - Retriable Errors Should Trigger Automatic Fallback

This test MUST be written BEFORE implementing the fix and should FAIL on unfixed code.
The failure demonstrates that the bug exists.

**CRITICAL**: This test is EXPECTED TO FAIL on unfixed code (proves bug exists).
After implementing the fix, this same test should PASS (proves fix works).

**DO NOT attempt to fix the test or the code when it fails during Task 1.**

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**

## Counterexamples Documented (from unfixed code run):

1. **Primary Rate Limit (HTTP 429)**
   - Input: Primary model returns HTTP 429
   - Expected: System automatically tries secondary model `qwen/qwen3.8-27b`
   - Actual (unfixed): RuntimeError "Groq rate limit reached..." with only 1 API call
   - Bug: No fallback mechanism present

2. **Primary Server Error (HTTP 5xx)**
   - Input: Primary model returns HTTP 503
   - Expected: System automatically tries secondary model
   - Actual (unfixed): RuntimeError "Groq feasibility request failed (HTTP 503)" with only 1 API call
   - Bug: No fallback on server errors

3. **Cascade Exhaustion**
   - Input: Primary and secondary both return 429
   - Expected: System tries all 3 models before failing
   - Actual (unfixed): System only tries 1 model
   - Bug: No model cascade implemented

4. **No Observability**
   - Expected: Logs showing which model was attempted
   - Actual (unfixed): No logging of model attempts or failures
   - Bug: No logging infrastructure for fallback behavior

## Test Status: ✗ FAILING ON UNFIXED CODE (This is correct - proves bug exists)
"""

import asyncio
import json
import sys
from pathlib import Path

# Ensure document_service is importable
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx
import pytest

from document_service import feasibility


def valid_report():
    """Generate a valid feasibility report for successful responses."""
    return {
        "summary": "Plan needs more detail before feasibility can be judged.",
        "dimensions": {
            name: {
                "status": "Needs clarification",
                "assessment": "The plan does not provide enough detail yet.",
                "known": "The student supplied a topic.",
                "unknown": "The study design remains undecided.",
                "evidence_ids": [],
            }
            for name in ("scope", "method_fit", "access", "timeline", "resources", "ethics")
        },
        "risks": [],
        "next_steps": [{"action": "Define a study design.", "reason": "The method is not yet known."}],
        "scope_adjustments": [],
        "missing_information": ["Proposed method"],
    }


class TestBugConditionExploration:
    """
    Bug condition exploration tests that demonstrate the bug in unfixed code.
    
    These tests encode the EXPECTED behavior (automatic fallback).
    On unfixed code: FAIL (no fallback implemented)
    On fixed code: PASS (fallback works correctly)
    """

    def test_primary_rate_limit_should_trigger_fallback(self, monkeypatch):
        """
        **Property 1: Bug Condition** - Primary HTTP 429 should trigger fallback
        
        **Validates: Requirements 2.1**
        
        Counterexample (unfixed code):
        - API calls made: 1
        - Error: "Groq rate limit reached for feasibility..."
        - Expected: 2+ calls (primary -> secondary)
        - Bug: No fallback attempted
        """
        monkeypatch.setenv("FEASIBILITY_GROQ_API_KEY", "test-key")
        monkeypatch.setenv("FEASIBILITY_GROQ_MODEL", "openai/gpt-oss-120b")
        
        call_count = []
        
        def handler(request):
            call_count.append(request.url.path)
            return httpx.Response(429, json={"error": "rate limit exceeded"})
        
        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                inputs = feasibility.StudentInputs(topic="Test topic")
                return await feasibility.assess(inputs, [], client)
        
        with pytest.raises(RuntimeError) as exc_info:
            asyncio.run(run())
        
        error_msg = str(exc_info.value)
        assert "rate limit" in error_msg.lower()
        
        # This assertion FAILS on unfixed code (bug exists), PASSES on fixed code
        assert len(call_count) > 1, (
            f"BUG DETECTED: Only {len(call_count)} model attempt(s) made. "
            f"Expected automatic fallback to secondary model on HTTP 429."
        )

    def test_primary_server_error_should_trigger_fallback(self, monkeypatch):
        """
        **Property 1: Bug Condition** - Primary HTTP 503 should trigger fallback
        
        **Validates: Requirements 2.4**
        
        Counterexample (unfixed code):
        - API calls made: 1
        - Error: "Groq feasibility request failed (HTTP 503)"
        - Expected: 2+ calls (primary -> secondary)
        - Bug: No fallback on server errors
        """
        monkeypatch.setenv("FEASIBILITY_GROQ_API_KEY", "test-key")
        monkeypatch.setenv("FEASIBILITY_GROQ_MODEL", "openai/gpt-oss-120b")
        
        call_count = []
        
        def handler(request):
            call_count.append(request.url.path)
            return httpx.Response(503, json={"error": "service unavailable"})
        
        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                inputs = feasibility.StudentInputs(topic="Test topic")
                return await feasibility.assess(inputs, [], client)
        
        with pytest.raises(RuntimeError) as exc_info:
            asyncio.run(run())
        
        error_msg = str(exc_info.value)
        assert "503" in error_msg or "fail" in error_msg.lower()
        
        # This assertion FAILS on unfixed code, PASSES on fixed code
        assert len(call_count) > 1, (
            f"BUG DETECTED: Only {len(call_count)} model attempt(s) made on HTTP 503."
        )

    def test_cascade_exhaustion_all_models_should_be_tried(self, monkeypatch):
        """
        **Property 1: Bug Condition** - All 3 models should be tried before failure
        
        **Validates: Requirements 2.2, 2.5**
        
        Counterexample (unfixed code):
        - API calls made: 1
        - Expected: 3 calls (primary -> secondary -> tertiary)
        - Bug: Cascade not implemented
        """
        monkeypatch.setenv("FEASIBILITY_GROQ_API_KEY", "test-key")
        monkeypatch.setenv("FEASIBILITY_GROQ_MODEL", "openai/gpt-oss-120b")
        
        call_count = []
        
        def handler(request):
            call_count.append(request.url.path)
            return httpx.Response(429, json={"error": "rate limit exceeded"})
        
        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                inputs = feasibility.StudentInputs(topic="Test topic")
                return await feasibility.assess(inputs, [], client)
        
        with pytest.raises(RuntimeError):
            asyncio.run(run())
        
        # This assertion FAILS on unfixed code, PASSES on fixed code
        assert len(call_count) == 3, (
            f"BUG DETECTED: Only {len(call_count)} model attempt(s) made. "
            f"Expected 3 attempts through full cascade."
        )

    def test_secondary_success_after_primary_failure(self, monkeypatch):
        """
        **Property 1: Bug Condition** - Secondary success should be returned
        
        **Validates: Requirements 2.1, 2.4**
        
        Counterexample (unfixed code):
        - API calls made: 1
        - Result: RuntimeError on first 429
        - Expected: Success with secondary model's response
        - Bug: Never attempts secondary model
        """
        monkeypatch.setenv("FEASIBILITY_GROQ_API_KEY", "test-key")
        monkeypatch.setenv("FEASIBILITY_GROQ_MODEL", "openai/gpt-oss-120b")
        
        call_count = []
        
        def handler(request):
            call_count.append(request.url.path)
            if len(call_count) == 1:
                return httpx.Response(429, json={"error": "rate limit exceeded"})
            else:
                return httpx.Response(200, json={
                    "choices": [{"message": {"content": json.dumps(valid_report())}}]
                })
        
        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                inputs = feasibility.StudentInputs(topic="Test topic")
                return await feasibility.assess(inputs, [], client)
        
        # On unfixed code: RuntimeError, on fixed code: success
        try:
            result = asyncio.run(run())
            # Fixed code path
            assert result["summary"] == "Plan needs more detail before feasibility can be judged."
            assert len(call_count) == 2
        except RuntimeError:
            # Unfixed code path
            assert len(call_count) == 1
            pytest.fail(
                f"BUG DETECTED: System raised RuntimeError after {len(call_count)} attempt(s). "
                "Expected automatic retry with secondary model."
            )

    def test_logging_of_model_attempts_should_exist(self, monkeypatch, caplog):
        """
        **Property 1: Bug Condition** - Model attempts should be logged
        
        **Validates: Requirements 2.7, 2.8, 2.9**
        
        Counterexample (unfixed code):
        - Logs captured: (empty or no model mentions)
        - Expected: Logs mentioning "attempting", model names, etc.
        - Bug: No logging infrastructure present
        """
        monkeypatch.setenv("FEASIBILITY_GROQ_API_KEY", "test-key")
        monkeypatch.setenv("FEASIBILITY_GROQ_MODEL", "openai/gpt-oss-120b")
        
        def handler(request):
            return httpx.Response(429, json={"error": "rate limit exceeded"})
        
        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                inputs = feasibility.StudentInputs(topic="Test topic")
                return await feasibility.assess(inputs, [], client)
        
        with pytest.raises(RuntimeError):
            asyncio.run(run())
        
        log_text = caplog.text.lower()
        
        # This assertion FAILS on unfixed code, PASSES on fixed code
        assert any(
            keyword in log_text 
            for keyword in ["attempting", "model", "gpt-oss", "qwen", "fallback"]
        ), (
            f"BUG DETECTED: No logging of model attempts found. "
            f"Expected logs showing which models were tried. "
            f"Log output (first 500 chars): {caplog.text[:500]}"
        )

    def test_mixed_error_types_should_all_trigger_fallback(self, monkeypatch):
        """
        **Property 1: Bug Condition** - Both 429 and 5xx should trigger fallback
        
        **Validates: Requirements 2.1, 2.2, 2.4, 2.5**
        
        Counterexample (unfixed code):
        - API calls made: 1
        - Expected: 3 calls with different errors
        - Bug: No uniform handling of retriable errors
        """
        monkeypatch.setenv("FEASIBILITY_GROQ_API_KEY", "test-key")
        monkeypatch.setenv("FEASIBILITY_GROQ_MODEL", "openai/gpt-oss-120b")
        
        call_count = []
        error_codes = [429, 503, 500]
        
        def handler(request):
            idx = len(call_count)
            call_count.append(idx)
            return httpx.Response(error_codes[idx] if idx < len(error_codes) else 500)
        
        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                inputs = feasibility.StudentInputs(topic="Test topic")
                return await feasibility.assess(inputs, [], client)
        
        with pytest.raises(RuntimeError):
            asyncio.run(run())
        
        # This assertion FAILS on unfixed code, PASSES on fixed code
        assert len(call_count) == 3, (
            f"BUG DETECTED: Only {len(call_count)} model attempt(s) with mixed errors."
        )


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s", "--tb=short"])
