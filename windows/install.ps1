[CmdletBinding()]
param(
    [switch]$NoDesktopShortcut
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectDir = Split-Path -Parent $PSScriptRoot
$MinimumNodeVersion = [version]'20.9.0'

function Write-Step {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Test-Command {
    param([Parameter(Mandatory = $true)][string]$Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Refresh-ProcessPath {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $wingetLinks = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links'
    $env:Path = @($machinePath, $userPath, $wingetLinks) -join ';'
}

function Install-WinGetPackage {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$DisplayName
    )

    if (-not (Test-Command 'winget.exe')) {
        throw "$DisplayName is required, and WinGet is unavailable. Install App Installer from Microsoft Store, then run this installer again."
    }

    Write-Step "Installing $DisplayName with WinGet"
    & winget.exe install --id $Id --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
    if ($LASTEXITCODE -ne 0) {
        throw "WinGet could not install $DisplayName (exit code $LASTEXITCODE)."
    }
    Refresh-ProcessPath
}

function Get-NpmCommand {
    $command = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        $command = Get-Command 'npm' -ErrorAction SilentlyContinue
    }
    if ($null -eq $command) {
        throw 'npm was not found after installing Node.js.'
    }
    return $command.Source
}

if ($env:OS -ne 'Windows_NT') {
    throw 'This installer only supports Windows.'
}

Write-Host 'WhisperForFiles Windows installer' -ForegroundColor Green
Write-Host "Project: $ProjectDir"

$nodeNeedsInstall = -not (Test-Command 'node.exe')
if (-not $nodeNeedsInstall) {
    try {
        $installedNodeVersion = [version](& node.exe -p 'process.versions.node')
        $nodeNeedsInstall = $installedNodeVersion -lt $MinimumNodeVersion
    }
    catch {
        $nodeNeedsInstall = $true
    }
}

if ($nodeNeedsInstall) {
    Install-WinGetPackage -Id 'OpenJS.NodeJS.LTS' -DisplayName 'Node.js LTS'
}

if (-not (Test-Command 'node.exe')) {
    throw 'Node.js is still unavailable. Restart Windows, then run this installer again.'
}

$installedNodeVersion = [version](& node.exe -p 'process.versions.node')
if ($installedNodeVersion -lt $MinimumNodeVersion) {
    throw "Node.js $MinimumNodeVersion or newer is required; found $installedNodeVersion."
}
Write-Host "Node.js $installedNodeVersion is ready." -ForegroundColor Green

if (-not (Test-Command 'ffmpeg.exe') -or -not (Test-Command 'ffprobe.exe')) {
    Install-WinGetPackage -Id 'Gyan.FFmpeg' -DisplayName 'FFmpeg'
}

if (-not (Test-Command 'ffmpeg.exe') -or -not (Test-Command 'ffprobe.exe')) {
    throw 'FFmpeg or ffprobe is still unavailable. Restart Windows, then run this installer again.'
}
Write-Host 'FFmpeg and ffprobe are ready.' -ForegroundColor Green

$npmCommand = Get-NpmCommand

Push-Location $ProjectDir
try {
    Write-Step 'Installing locked Node.js dependencies'
    & $npmCommand ci
    if ($LASTEXITCODE -ne 0) {
        throw "npm ci failed with exit code $LASTEXITCODE."
    }

    $envFile = Join-Path $ProjectDir '.env.local'
    if (-not (Test-Path -LiteralPath $envFile)) {
        Write-Step 'Creating .env.local'
        $envTemplate = @'
# Add at least one cloud transcription key, or paste a key in the app UI.
GROQ_API_KEY=
OPENAI_API_KEY=

# Optional AI analysis providers.
KIMI_API_KEY=
DEEPSEEK_API_KEY=
AI_ANALYSIS_PROVIDER=kimi
'@
        $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
        [IO.File]::WriteAllText($envFile, $envTemplate.TrimStart(), $utf8WithoutBom)
        Write-Host 'Created .env.local without any credentials.' -ForegroundColor Green
    }
    else {
        Write-Host 'Preserved the existing .env.local file.' -ForegroundColor Green
    }

    Write-Step 'Building WhisperForFiles'
    & $npmCommand run build
    if ($LASTEXITCODE -ne 0) {
        throw "The application build failed with exit code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}

if (-not $NoDesktopShortcut) {
    Write-Step 'Creating Desktop shortcut'
    $launcher = Join-Path $ProjectDir 'Start-WhisperForFiles-Windows.cmd'
    $desktop = [Environment]::GetFolderPath('Desktop')
    $shortcutPath = Join-Path $desktop 'WhisperForFiles.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $launcher
    $shortcut.WorkingDirectory = $ProjectDir
    $shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,220"
    $shortcut.Description = 'Start WhisperForFiles'
    $shortcut.Save()
    Write-Host "Shortcut created: $shortcutPath" -ForegroundColor Green
}

Write-Host "`nInstallation complete." -ForegroundColor Green
Write-Host '1. Add a GROQ_API_KEY to .env.local, or paste it in the app.'
Write-Host '2. Run Start-WhisperForFiles-Windows.cmd (or the Desktop shortcut).'
Write-Host 'Windows uses cloud transcription; Local Metal mode is Apple Silicon-only.'
