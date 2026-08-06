[CmdletBinding()]
param(
    [ValidateSet('auto', 'windows-nvidia', 'universal-vulkan', 'universal-cpu')]
    [string]$Profile = 'auto'
)

$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $ProjectDir 'local_backend'
$VenvDir = Join-Path $BackendDir '.venv-windows'
$VenvPython = Join-Path $VenvDir 'Scripts\python.exe'

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'npm was not found. Install Node.js 18 or newer.'
}

$Python = $null
foreach ($candidate in @('python3.12', 'python3.11', 'python3', 'python')) {
    $command = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($command) {
        $Python = $command.Source
        break
    }
}
if (-not $Python) {
    throw 'Python 3.10 or newer was not found.'
}

if ($Profile -eq 'auto') {
    $Profile = (& $Python (Join-Path $BackendDir 'detect_profile.py')).Trim()
}

$Requirements = Join-Path $BackendDir "requirements\$Profile.txt"
if (-not (Test-Path -LiteralPath $Requirements)) {
    throw "Unsupported or missing runtime profile: $Profile"
}

Write-Host "Local runtime profile: $Profile" -ForegroundColor Cyan
if ($Profile -eq 'windows-nvidia') {
    Write-Warning 'Native Windows CUDA requires CUDA 12 and cuDNN 9 DLLs on PATH.'
}

if (-not (Test-Path -LiteralPath $VenvPython)) {
    Write-Host 'Creating the Windows Python environment...'
    & $Python -m venv $VenvDir
}

& $VenvPython -m pip install --upgrade pip
& $VenvPython -m pip install -r $Requirements

if (-not (Test-Path -LiteralPath (Join-Path $ProjectDir 'node_modules'))) {
    Write-Warning 'node_modules is missing; npm install may download several hundred MB.'
    Push-Location $ProjectDir
    try {
        npm install
    }
    finally {
        Pop-Location
    }
}

$backend = Start-Process -FilePath $VenvPython `
    -ArgumentList @('-m', 'uvicorn', 'server:app', '--host', '127.0.0.1', '--port', '8001') `
    -WorkingDirectory $BackendDir `
    -PassThru `
    -NoNewWindow

try {
    Write-Host 'Backend: http://127.0.0.1:8001' -ForegroundColor Green
    Write-Host 'Frontend: http://localhost:3000' -ForegroundColor Green
    Push-Location $ProjectDir
    npm run dev
}
finally {
    Pop-Location
    if (-not $backend.HasExited) {
        Stop-Process -Id $backend.Id
    }
}
