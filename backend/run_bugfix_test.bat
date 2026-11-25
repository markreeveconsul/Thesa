@echo off
cd /d "%~dp0"
.venv\Scripts\pytest.exe document_tests\test_feasibility_bugfix.py -v -s
pause
