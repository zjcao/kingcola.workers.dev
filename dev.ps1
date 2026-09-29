<#
.SYNOPSIS
    拾光工作室官网 —— dev 模式启动脚本（Vite 7 + React 19 + TS）

.DESCRIPTION
    本机全局 PATH 中没有 node / npm，脚本会：
      1) 把 D:\usexxx\node\versions\<NodeVersion> 注入当前会话 PATH
      2) 缺少 node_modules 时自动执行 npm install
      3) 检测端口占用（默认 3000，被占用则自动向后找空闲端口）
      4) 执行 npm run dev 启动 Vite dev server

.PARAMETER NodeVersion
    要使用的 Node 版本，默认 22.23.2（Vite 7 要求 Node >= 20.19）

.PARAMETER Port
    期望的监听端口，默认 3000。若被占用会自动向后寻找空闲端口。

.PARAMETER SkipInstall
    跳过依赖安装步骤

.PARAMETER Reinstall
    先删除 node_modules 再重新安装

.EXAMPLE
    .\dev.ps1

.EXAMPLE
    .\dev.ps1 -Port 5173

.EXAMPLE
    .\dev.ps1 -NodeVersion 20.15.1 -SkipInstall

.EXAMPLE
    .\dev.ps1 -Reinstall
#>
[CmdletBinding()]
param(
    [string] $NodeVersion = '22.23.2',
    [int] $Port = 3000,
    [switch] $SkipInstall,
    [switch] $Reinstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function Write-Step { param([string] $Text) Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Write-Ok { param([string] $Text) Write-Host "    $Text" -ForegroundColor DarkGray }
function Write-Warn { param([string] $Text) Write-Host "    $Text" -ForegroundColor Yellow }
function Stop-Script { param([string] $Text) Write-Host "`n[ERROR] $Text" -ForegroundColor Red; exit 1 }

function Test-PortFree {
    param([int] $PortNumber)
    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $PortNumber)
        $listener.Start()
        return $true
    }
    catch {
        return $false
    }
    finally {
        if ($listener) { $listener.Stop() }
    }
}

$ProjectRoot = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$NodeRoot = 'D:\usexxx\node\versions'

# ---------------------------------------------------------------- 0. 项目校验
$packageJson = Join-Path $ProjectRoot 'package.json'
if (-not (Test-Path $packageJson)) {
    Stop-Script "未在 $ProjectRoot 找到 package.json，请把 dev.ps1 放在项目根目录下运行。"
}

# ---------------------------------------------------------------- 1. 注入 Node
Write-Step '准备 Node 运行时'
$nodeDir = Join-Path $NodeRoot $NodeVersion
if (-not (Test-Path (Join-Path $nodeDir 'node.exe'))) {
    $available = @(Get-ChildItem $NodeRoot -Directory -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty Name)
    if ($available.Count -gt 0) { Write-Ok "可用版本：$($available -join ', ')" }
    Stop-Script "在 $NodeRoot 下找不到 Node $NodeVersion，请用 -NodeVersion 指定可用版本。"
}

$env:PATH = "$nodeDir;$env:PATH"
$npmCmd = Join-Path $nodeDir 'npm.cmd'

$nodeVer = (& node -v).Trim()
$npmVer = (& $npmCmd -v).Trim()
Write-Ok "Node $nodeVer / npm $npmVer"
Write-Ok $nodeDir

# Vite 7 要求 Node >= 20.19
$parts = $nodeVer.TrimStart('v').Split('.')
$major = [int] $parts[0]
$minor = [int] $parts[1]
if ($major -lt 20 -or ($major -eq 20 -and $minor -lt 19)) {
    Stop-Script "当前 Node $nodeVer 版本过低，Vite 7 需要 >= 20.19，请改用 -NodeVersion 22.23.2。"
}

Set-Location $ProjectRoot

# ---------------------------------------------------------------- 2. 安装依赖
$nodeModules = Join-Path $ProjectRoot 'node_modules'
if ($Reinstall -and (Test-Path $nodeModules)) {
    Write-Step '清理 node_modules（-Reinstall）'
    Remove-Item $nodeModules -Recurse -Force
}

if ($SkipInstall) {
    Write-Step '跳过依赖安装（-SkipInstall）'
    if (-not (Test-Path $nodeModules)) { Write-Ok '注意：node_modules 不存在，启动可能会失败。' }
}
elseif (-not (Test-Path $nodeModules)) {
    Write-Step '首次安装依赖，可能需要几分钟……'
    & $npmCmd install
    if ($LASTEXITCODE -ne 0) { Stop-Script "npm install 失败（exit code $LASTEXITCODE）。" }
}
else {
    Write-Step '依赖检查'
    Write-Ok 'node_modules 已存在，跳过安装（强制重装请加 -Reinstall）'
}

# ---------------------------------------------------------------- 3. 选择端口
Write-Step '选择监听端口'
$usePort = $Port
if (-not (Test-PortFree $usePort)) {
    Write-Warn "端口 $usePort 已被占用，向后查找空闲端口……"
    $limit = [Math]::Min($Port + 50, 65535)
    while (-not (Test-PortFree $usePort) -and $usePort -lt $limit) { $usePort++ }
    if (-not (Test-PortFree $usePort)) { Stop-Script "从 $Port 起 50 个端口内没有可用端口，请用 -Port 指定。" }
    Write-Warn "改用端口 $usePort"
}
Write-Ok "最终端口：$usePort"

# ---------------------------------------------------------------- 4. 启动 dev
Write-Step '启动 Vite dev server'
Write-Ok "地址：http://localhost:$usePort    (Ctrl+C 结束)"
& $npmCmd run dev -- --port $usePort
exit $LASTEXITCODE
