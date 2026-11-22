"""Simple test runner for bugfix exploration test."""
import sys
from pathlib import Path

# Add parent directory to path so we can import document_service
backend_path = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(backend_path))

# Change to backend directory for relative imports to work
import os
os.chdir(str(backend_path))

# Now run pytest
import pytest

if __name__ == "__main__":
    test_file = backend_path / "document_tests" / "test_feasibility_bugfix.py"
    exit_code = pytest.main([
        str(test_file),
        "-v",
        "-s",
        "--tb=short"
    ])
    print(f"\nPytest exit code: {exit_code}")
    sys.exit(exit_code)
