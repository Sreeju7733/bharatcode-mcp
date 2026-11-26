# Note: Run with 'Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass' if execution policy prevents running scripts.
# Usage: powershell -ExecutionPolicy Bypass -File .\install.ps1 [preset]

param (
    [string]$Preset = "core"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command "npx" -ErrorAction SilentlyContinue)) {
    Write-Error "error: Node.js 20+ is required.`nInstall via winget install OpenJS.NodeJS.LTS or https://nodejs.org"
    exit 1
}

$NodeVersion = node -p 'process.versions.node.split(".")[0]' 2>$null
if (-not $NodeVersion -or [int]$NodeVersion -lt 20) {
    $found = node --version 2>$null
    Write-Error "error: Node.js 20+ required (found $found)."
    exit 1
}

if (-not (Get-Command "uvx" -ErrorAction SilentlyContinue)) {
    Write-Host "Installing uv for Python-based MCP servers..."
    powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
    $env:Path = "$HOME\.local\bin;$env:Path"
}

npx -y bharatcode-mcp@latest init --preset $Preset --yes
npx -y bharatcode-mcp@latest doctor
