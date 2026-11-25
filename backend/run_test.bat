@echo off
setlocal
cd /d "%~dp0"
echo Running bug condition exploration test...
echo.
".venv\Scripts\python.exe" "document_tests\run_bugfix_test.py"
echo.
echo Test run complete.
pause
