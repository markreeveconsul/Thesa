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
$canonicalRoot = [IO.Path]::GetFullPath($root).TrimEnd([char[]]@('\', '/')).ToLowerInvariant()
$sha256 = [Security.Cryptography.SHA256]::Create()
try {
    $workspaceMarker = [BitConverter]::ToString(
        $sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonicalRoot))
    ).Replace('-', '').ToLowerInvariant()
} finally {
    $sha256.Dispose()
}

function Test-Port([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try { $client.Connect('127.0.0.1', $Port); return $true }
    catch { return $false }
    finally { $client.Dispose() }
}

function Test-FrontendProcess {
    $listener = Get-NetTCPConnection -LocalPort 3002 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (!$listener) { return $false }

    $expectedServer = Join-Path $frontend 'node_modules\next\dist\server\lib\start-server.js'
    $serverFromThisCheckout = $false
    $isDevelopmentServer = $false
    $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
    for ($depth = 0; $current -and $depth -lt 6; $depth++) {
        $command = [string]$current.CommandLine
        if ($command.IndexOf($expectedServer, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            $serverFromThisCheckout = $true
        }
        if (
            $command.IndexOf($next, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $command -match '(?i)\bdev\b' -and
            $command -match '--port\s+3002'
        ) {
            $isDevelopmentServer = $true
        }
        if (!$current.ParentProcessId) { break }
        $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($current.ParentProcessId)" -ErrorAction SilentlyContinue
    }
    return $serverFromThisCheckout -and $isDevelopmentServer
}

function Test-Service([string]$Kind) {
    try {
        if ($Kind -eq 'backend') {
            $health = Invoke-RestMethod "$apiUrl/health" -TimeoutSec 3
            if ($health.status -ne 'ok' -or $health.service -ne 'thesa-documents' -or $health.workspace -ne $workspaceMarker) { return $false }
            try {
                Invoke-WebRequest "$apiUrl/chat" -Method Get -UseBasicParsing -TimeoutSec 3 | Out-Null
                return $false
            } catch {
                if (!$_.Exception.Response -or [int]$_.Exception.Response.StatusCode -ne 405) { return $false }
            }
            $chatHealth = Invoke-RestMethod "$apiUrl/chat/health" -TimeoutSec 3
            if ($chatHealth.status -ne 'ok' -or $chatHealth.provider -ne 'gemini' -or $chatHealth.provider_fallbacks -ne $false -or $chatHealth.chat_contract -ne 'bounded-history-v2') { return $false }
            $response = Invoke-WebRequest "$apiUrl/parse" -Method Options -UseBasicParsing -TimeoutSec 3 -Headers @{
                Origin = $appUrl
                'Access-Control-Request-Method' = 'POST'
                'Access-Control-Request-Headers' = 'content-type,x-filename'
            }
            return $response.Headers['Access-Control-Allow-Origin'] -eq $appUrl
        }
        if (!(Test-FrontendProcess)) { return $false }
        $response = Invoke-WebRequest $appUrl -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -ne 200 -or $response.Headers['X-Thesa-Workspace'] -ne $workspaceMarker) { return $false }
        try {
            $mascot = Invoke-WebRequest "$appUrl/mascot/scholar-welcome.jpg" -UseBasicParsing -TimeoutSec 5
            return $mascot.StatusCode -eq 200
        } catch {
            return $false
        }
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
            throw "Port 8000 is serving a different checkout or incompatible parser. Stop its launcher, then run Start Thesa.bat from $root."
        }
        Write-Host 'Document service already running.'
    } else {
        $env:THESA_WORKSPACE_MARKER = $workspaceMarker
        $process = Start-Process -FilePath $python -ArgumentList '-m uvicorn document_service.main:app --host 127.0.0.1 --port 8000' -WorkingDirectory $backend -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs 'backend.log') -RedirectStandardError (Join-Path $logs 'backend-error.log')
        $ownedProcesses += $process
        Wait-Service 'backend' $process
        Write-Host 'Document service ready.'
    }

    if (Test-Port 3002) {
        if (!(Test-Service 'frontend')) { throw "Port 3002 is serving a different checkout or stale build. Stop its launcher, then run Start Thesa.bat from $root." }
        Write-Host 'Thesa frontend already running.'
    } else {
        # Separate dev output prevents production builds from breaking this preview.
        $env:NEXT_DIST_DIR = '.next-launcher'
        $env:NEXT_THESA_WORKSPACE_MARKER = $workspaceMarker
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
