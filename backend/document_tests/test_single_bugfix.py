"""
Single bug condition exploration test - simplified version.

This test MUST FAIL on unfixed code, demonstrating the bug exists.
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


def test_primary_rate_limit_should_trigger_fallback_to_secondary(monkeypatch):
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
    
    print(f"\n✓ Error message confirmed: {error_msg}")
    print(f"✓ Number of API calls made: {len(call_count)}")
    
    # CRITICAL CHECK: On unfixed code, only ONE model is attempted
    # On fixed code, we expect MULTIPLE attempts (primary, then secondary)
    # This assertion will FAIL on unfixed code (showing bug exists)
    # and PASS on fixed code (showing bug is fixed)
    assert len(call_count) > 1, (
        f"BUG DETECTED: Only {len(call_count)} model attempt(s) made. "
        f"Expected automatic fallback to secondary model on HTTP 429. "
        f"Unfixed code fails immediately without trying alternative models."
    )


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
