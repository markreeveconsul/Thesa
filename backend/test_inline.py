"""Direct inline test without pytest framework."""
import asyncio
import json
import sys
import os
from pathlib import Path

# Add backend to path
backend = Path(__file__).parent
sys.path.insert(0, str(backend))
os.chdir(str(backend))

print("Starting inline bugfix test...")
print(f"Working directory: {os.getcwd()}")
print(f"Python path: {sys.path[0]}")

# Set environment variables
os.environ["FEASIBILITY_GROQ_API_KEY"] = "test-key"
os.environ["FEASIBILITY_GROQ_MODEL"] = "openai/gpt-oss-120b"

try:
    import httpx
    from document_service import feasibility
    print("✓ Imports successful")
except ImportError as e:
    print(f"✗ Import failed: {e}")
    sys.exit(1)

def valid_report():
    """Generate a valid feasibility report."""
    return {
        "summary": "Plan needs more detail.",
        "dimensions": {
            name: {
                "status": "Needs clarification",
                "assessment": "Not enough detail yet.",
                "known": "Topic supplied.",
                "unknown": "Design undecided.",
                "evidence_ids": [],
            }
            for name in ("scope", "method_fit", "access", "timeline", "resources", "ethics")
        },
        "risks": [],
        "next_steps": [{"action": "Define design.", "reason": "Method unknown."}],
        "scope_adjustments": [],
        "missing_information": ["Method"],
    }

# Test 1: Primary rate limit - should fail on unfixed code
print("\n" + "="*70)
print("TEST 1: Primary model HTTP 429 - should trigger fallback")
print("="*70)

call_count = []

def handler(request):
    call_count.append(request.url.path)
    print(f"  API call #{len(call_count)}: {request.url}")
    # Primary model returns 429 (rate limit)
    return httpx.Response(429, json={"error": "rate limit exceeded"})

async def run_test():
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        inputs = feasibility.StudentInputs(topic="Test topic")
        return await feasibility.assess(inputs, [], client)

try:
    result = asyncio.run(run_test())
    print(f"✗ UNEXPECTED: Test completed without error. Result: {result}")
    success = False
except RuntimeError as e:
    error_msg = str(e)
    print(f"✓ RuntimeError raised as expected: {error_msg}")
    
    if "rate limit" not in error_msg.lower():
        print(f"✗ UNEXPECTED: Error message doesn't mention rate limit")
        success = False
    else:
        print(f"✓ Error message mentions rate limit")
        
    print(f"\nAPI call count: {len(call_count)}")
    
    if len(call_count) > 1:
        print(f"✓ FIXED CODE: Multiple models attempted ({len(call_count)} calls)")
        print("  This means fallback is working!")
        success = True
    else:
        print(f"✗ BUG DETECTED: Only {len(call_count)} model attempt")
        print("  Expected automatic fallback to secondary model on HTTP 429")
        print("  Unfixed code fails immediately without trying alternative models")
        success = False
        
except Exception as e:
    print(f"✗ Unexpected exception: {type(e).__name__}: {e}")
    success = False

print("\n" + "="*70)
if success:
    print("RESULT: BUG IS FIXED - Fallback working as expected")
else:
    print("RESULT: BUG EXISTS - No fallback mechanism present")
print("="*70)

sys.exit(0 if not success else 1)  # Exit 0 if bug exists (expected on unfixed code)
