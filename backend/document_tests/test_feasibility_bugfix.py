"""
Bug Condition Exploration Test for Feasibility Model Fallback

This test MUST be written BEFORE implementing the fix and should FAIL on unfixed code.
The failure demonstrates that the bug exists.

**Property 1: Bug Condition** - Retriable Errors Trigger Immediate Failure Without Fallback

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**

Expected behavior (after fix):
- When primary model returns HTTP 429 or 5xx, system automatically retries with secondary model
- When secondary model also fails, system tries tertiary model
- System logs all model attempts and failures
- System exhausts all three models before final failure

Actual behavior (unfixed code):
- System raises RuntimeError immediately on first 429 or 5xx
- No fallback to secondary or tertiary models
- No logging of model attempts
"""

import asyncio
import json
from unittest.mock import Mock, patch

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

    def test_primary_rate_limit_should_trigger_fallback_to_secondary(self, monkeypatch):
        """
        **Property 1: Bug Condition** - Primary model HTTP 429 should trigger automatic fallback
        
        Expected (after fix): Secondary model is attempted automatically
        Actual (unfixed): RuntimeError raised immediately, no fallback
        
        **Validates: Requirements 2.1**
        """
        monkeypatch.setenv("FEASIBILITY_GROQ_API_KEY", "test-key")
        monkeypatch.setenv("FEASIBILITY_GROQ_MODEL", "openai/gpt-oss-120b")
        
        call_count = []
        
        def handler(request):
            call_count.append(request.url.path)
            # Primary model returns 429 (rate limit)
            return httpx.Response(429, json={"error": "rate limit exceeded"})
        
        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                inputs = feasibility.StudentInputs(topic="Test topic")
                return await feasibility.assess(inputs, [], client)
        
        # On unfixed code: This will raise RuntimeError immediately
        # On fixed code: This should attempt secondary model (qwen/qwen3.8-27b)
        with pytest.raises(RuntimeError) as exc_info:
            asyncio.run(run())
        
        # Document the counterexample:
        # Unfixed code raises: "Groq rate limit reached for feasibility..."
        error_msg = str(exc_info.value)
        assert "rate limit" in error_msg.lower(), f"Expected rate limit error, got: {error_msg}"
        
        # CRITICAL CHECK: On unfixed code, only ONE model is attempted
        # On fixed code, we expect MULTIPLE attempts (primary, then secondary)
        # This assertion will FAIL on unfixed code (showing bug exists)
        # and PASS on fixed code (showing bug is fixed)
        assert len(call_count) > 1, (
            f"BUG DETECTED: Only {len(call_count)} model attempt(s) made. "
            f"Expected automatic fallback to secondary model on HTTP 429. "
            f"Unfixed code fails immediately without trying alternative models."
        )

    def test_primary_server_error_should_trigger_fallback_to_secondary(self, monkeypatch):
        """
        **Property 1: Bug Condition** - Primary model HTTP 503 should trigger automatic fallback
        
        Expected (after fix): Secondary model is attempted automatically
        Actual (unfixed): RuntimeError raised immediately, no fallback
        
        **Validates: Requirements 2.4**
        """
        monkeypatch.setenv("FEASIBILITY_GROQ_API_KEY", "test-key")
        monkeypatch.setenv("FEASIBILITY_GROQ_MODEL", "openai/gpt-oss-120b")
        
        call_count = []
        
        def handler(request):
            call_count.append(request.url.path)
            # Primary model returns 503 (server error)
            return httpx.Response(503, json={"error": "service unavailable"})
        
        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                inputs = feasibility.StudentInputs(topic="Test topic")
                return await feasibility.assess(inputs, [], client)
        
        # On unfixed code: This will raise RuntimeError immediately
        # On fixed code: This should attempt secondary model
        with pytest.raises(RuntimeError) as exc_info:
            asyncio.run(run())
        
        # Document the counterexample:
        error_msg = str(exc_info.value)
        assert "503" in error_msg or "fail" in error_msg.lower(), (
            f"Expected server error message, got: {error_msg}"
        )
        
        # CRITICAL CHECK: Verify fallback was attempted
        # This will FAIL on unfixed code (bug exists)
        assert len(call_count) > 1, (
            f"BUG DETECTED: Only {len(call_count)} model attempt(s) made on HTTP 503. "
            f"Expected automatic fallback to secondary model on server errors. "
            f"Unfixed code fails immediately without trying alternative models."
        )

    def test_primary_and_secondary_fail_should_try_tertiary(self, monkeypatch):
        """
        **Property 1: Bug Condition** - When primary and secondary fail, tertiary should be tried
        
        Expected (after fix): All three models attempted before failure
        Actual (unfixed): Only primary attempted, immediate failure
        
        **Validates: Requirements 2.2, 2.5**
        """
        monkeypatch.setenv("FEASIBILITY_GROQ_API_KEY", "test-key")
        monkeypatch.setenv("FEASIBILITY_GROQ_MODEL", "openai/gpt-oss-120b")
        
        call_count = []
        
        def handler(request):
            call_count.append(request.url.path)
            # All models return 429
            return httpx.Response(429, json={"error": "rate limit exceeded"})
        
        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                inputs = feasibility.StudentInputs(topic="Test topic")
                return await feasibility.assess(inputs, [], client)
        
        with pytest.raises(RuntimeError) as exc_info:
            asyncio.run(run())
        
        error_msg = str(exc_info.value)
        assert "rate limit" in error_msg.lower()
        
        # CRITICAL CHECK: Should attempt all THREE models
        # Unfixed code: only 1 attempt
        # Fixed code: 3 attempts (primary -> secondary -> tertiary)
        assert len(call_count) == 3, (
            f"BUG DETECTED: Only {len(call_count)} model attempt(s) made. "
            f"Expected 3 attempts (primary -> secondary -> tertiary) before final failure. "
            f"Unfixed code stops after first failure without exhausting model cascade."
        )

    def test_fallback_should_succeed_when_secondary_works(self, monkeypatch):
        """
        **Property 1: Bug Condition** - Secondary model success after primary failure
        
        Expected (after fix): Returns successful response from secondary model
        Actual (unfixed): Fails on primary error without trying secondary
        
        **Validates: Requirements 2.1, 2.4**
        """
        monkeypatch.setenv("FEASIBILITY_GROQ_API_KEY", "test-key")
        monkeypatch.setenv("FEASIBILITY_GROQ_MODEL", "openai/gpt-oss-120b")
        
        call_count = []
        
        def handler(request):
            call_count.append(request.url.path)
            if len(call_count) == 1:
                # Primary model returns 429
                return httpx.Response(429, json={"error": "rate limit exceeded"})
            else:
                # Secondary model succeeds
                return httpx.Response(200, json={
                    "choices": [{"message": {"content": json.dumps(valid_report())}}]
                })
        
        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                inputs = feasibility.StudentInputs(topic="Test topic")
                return await feasibility.assess(inputs, [], client)
        
        # On unfixed code: RuntimeError on first 429, never tries secondary
        # On fixed code: Should succeed with secondary model's response
        try:
            result = asyncio.run(run())
            # If we got here, fallback worked (fixed code)
            assert result["summary"] == "Plan needs more detail before feasibility can be judged."
            assert len(call_count) == 2, "Should have tried primary, then secondary"
        except RuntimeError:
            # Unfixed code path: immediate failure
            assert len(call_count) == 1, (
                f"BUG DETECTED: Failed on first model attempt without trying secondary. "
                f"Attempts made: {len(call_count)}"
            )
            pytest.fail(
                "BUG DETECTED: System raised RuntimeError on primary model failure "
                "without attempting secondary model fallback. Expected automatic retry."
            )

    def test_logging_of_model_attempts(self, monkeypatch, caplog):
        """
        **Property 1: Bug Condition** - Model attempts should be logged for observability
        
        Expected (after fix): Logs show which models were attempted and their outcomes
        Actual (unfixed): No logging of model attempts or failures
        
        **Validates: Requirements 2.7, 2.8, 2.9**
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
        
        # Check for logging
        log_text = caplog.text.lower()
        
        # CRITICAL CHECK: Logs should mention model attempts
        # Unfixed code: No logging present
        # Fixed code: Logs contain model names and attempt information
        assert any(
            keyword in log_text 
            for keyword in ["attempting", "model", "gpt-oss", "qwen"]
        ), (
            f"BUG DETECTED: No logging of model attempts found. "
            f"Expected logs showing which models were tried. "
            f"Unfixed code provides no observability into fallback behavior. "
            f"Log output: {caplog.text[:200]}"
        )

    def test_mixed_retriable_errors_exhaust_cascade(self, monkeypatch):
        """
        **Property 1: Bug Condition** - Different retriable errors (429, 5xx) should all trigger fallback
        
        Expected (after fix): System tries all models regardless of specific error code
        Actual (unfixed): Fails on first error without fallback
        
        **Validates: Requirements 2.1, 2.2, 2.4, 2.5**
        """
        monkeypatch.setenv("FEASIBILITY_GROQ_API_KEY", "test-key")
        monkeypatch.setenv("FEASIBILITY_GROQ_MODEL", "openai/gpt-oss-120b")
        
        call_count = []
        error_codes = [429, 503, 500]  # Mix of rate limit and server errors
        
        def handler(request):
            idx = len(call_count)
            call_count.append(idx)
            # Return different error codes for each attempt
            return httpx.Response(error_codes[idx] if idx < len(error_codes) else 500)
        
        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                inputs = feasibility.StudentInputs(topic="Test topic")
                return await feasibility.assess(inputs, [], client)
        
        with pytest.raises(RuntimeError) as exc_info:
            asyncio.run(run())
        
        # CRITICAL CHECK: All three models should be attempted
        assert len(call_count) == 3, (
            f"BUG DETECTED: Only {len(call_count)} model attempt(s) made with mixed errors. "
            f"Expected 3 attempts through full cascade. "
            f"Unfixed code doesn't handle retriable errors uniformly."
        )


if __name__ == "__main__":
    # Run tests to demonstrate bug existence
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    pytest.main([__file__, "-v", "-s"])
