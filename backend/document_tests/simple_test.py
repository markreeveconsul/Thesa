"""Simple standalone test to verify test execution works."""
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

def test_simple():
    """Basic test to verify pytest execution."""
    assert 1 + 1 == 2
    print("\n✓ Simple test passed!")

if __name__ == "__main__":
    import pytest
    exit_code = pytest.main([__file__, "-v", "-s"])
    print(f"Exit code: {exit_code}")
    sys.exit(exit_code)
