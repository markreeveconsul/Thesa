param([switch]$SmokeTest)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$frontend = Join-Path $root 'frontend'
$backend = Join-Path $root 'backend'
$venvPython = Join-Path $backend '.venv\Scripts\python.exe'
$python = if (Test-Path $venvPython) { $venvPython } else { (Get-Command python.exe -ErrorAction Stop).Source }
$next = Join-Path $frontend 'node_modules\next\dist\bin\next'
$logs = Join-Path $root '.thesa-run'
$appUrl = 'http://127.0.0.1:3002'
$apiUrl = 'http://127.0.0.1:8000'
$ownedProcesses = @()

function Test-Port([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try { $client.Connect('127.0.0.1', $Port); return $true }
    catch { return $false }
    finally { $client.Dispose() }
}

function Test-Service([string]$Kind) {
    try {
        if ($Kind -eq 'backend') {
            $health = Invoke-RestMethod "$apiUrl/health" -TimeoutSec 3
            return $health.status -eq 'ok' -and $health.service -eq 'thesa-documents'
        }
        $response = Invoke-WebRequest $appUrl -UseBasicParsing -TimeoutSec 5
        return $response.StatusCode -eq 200 -and $response.Content.Contains('Thesa')
    } catch { return $false }
}

function Wait-Service([string]$Kind, $Process) {
    $deadline = (Get-Date).AddSeconds(120)
    while ((Get-Date) -lt $deadline) {
        if ($Process.HasExited) { throw "$Kind stopped. Check the logs in $logs." }
        if (Test-Service $Kind) { return }
        Start-Sleep -Seconds 1
    }
    throw "$Kind did not become ready. Check the logs in $logs."
}

try {
    $Host.UI.RawUI.WindowTitle = 'Thesa - keep this window open'
    Write-Host 'Starting Thesa...' -ForegroundColor Cyan
    if (!(Get-Command python.exe -ErrorAction SilentlyContinue) -and !(Test-Path $venvPython)) {
        throw "Python is missing. Install Python 3.11+ and rerun Start Thesa.bat."
    }
    if (!(Test-Path $next)) {
        throw "Frontend dependencies are missing. Run npm install in the frontend folder, then rerun Start Thesa.bat."
    }
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    New-Item -ItemType Directory -Force -Path $logs | Out-Null

    if (Test-Port 8000) {
        if (!(Test-Service 'backend')) {
            throw 'Port 8000 is serving an older or incompatible Thesa backend. Close the terminal/window that started the old backend (or press Enter in its Thesa launcher window), then run Start Thesa.bat again.'
        }
        Write-Host 'Document service already running.'
    } else {
        $process = Start-Process -FilePath $python -ArgumentList '-m uvicorn document_service.main:app --host 127.0.0.1 --port 8000' -WorkingDirectory $backend -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs 'backend.log') -RedirectStandardError (Join-Path $logs 'backend-error.log')
        $ownedProcesses += $process
        Wait-Service 'backend' $process
        Write-Host 'Document service ready.'
    }

    if (Test-Port 3002) {
        if (!(Test-Service 'frontend')) { throw 'Port 3002 is in use by another or unready app. Close its terminal and try again.' }
        Write-Host 'Thesa frontend already running.'
    } else {
        # Separate dev output prevents production builds from breaking this preview.
        $env:NEXT_DIST_DIR = '.next-launcher'
        $env:NEXT_PUBLIC_DOCUMENT_API_URL = $apiUrl
        $process = Start-Process -FilePath $node -ArgumentList @('"' + $next + '"', 'dev', '--hostname', '127.0.0.1', '--port', '3002') -WorkingDirectory $frontend -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs 'frontend.log') -RedirectStandardError (Join-Path $logs 'frontend-error.log')
        $ownedProcesses += $process
        Wait-Service 'frontend' $process
        Write-Host 'Thesa frontend ready.'
    }

    Write-Host "Ready: $appUrl" -ForegroundColor Green
    if (!$SmokeTest) {
        Start-Process $appUrl
        Write-Host 'Keep this window open while using Thesa. Logs are in .thesa-run.'
        Read-Host 'Press Enter here to stop services started by this launcher' | Out-Null
    }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
} finally {
    # Stop only process trees created by this invocation, never reused services.
    foreach ($process in $ownedProcesses) {
        if (!$process.HasExited) {
            & taskkill.exe /PID $process.Id /T /F 2>&1 | Out-Null
        }
    }
}
