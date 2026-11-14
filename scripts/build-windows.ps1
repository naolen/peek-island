# 余光 Peek Island：在本机打包成 exe
# 用法：双击仓库根目录的 build.bat；在国内网络下用 build.bat cn（走国内镜像，下载快很多）
param([string]$Mirror = '')

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($text) { Write-Host ''; Write-Host "==> $text" -ForegroundColor Cyan }
function Fail($text) {
  Write-Host ''
  Write-Host "打包失败：$text" -ForegroundColor Red
  Write-Host ''
  Read-Host '按回车键关闭'
  exit 1
}

if ($Mirror -eq 'cn') {
  Step '使用国内镜像（npmmirror）'
  $env:npm_config_registry = 'https://registry.npmmirror.com'
  $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
  $env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
}

Step '检查 Node.js'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail '没有找到 Node.js。请先安装 Node.js 20 或更新版本：https://nodejs.org/zh-cn （安装后重新打开这个窗口）' }
$ver = (node -v).TrimStart('v')
if ([int]($ver.Split('.')[0]) -lt 20) { Fail "Node.js 版本太旧（当前 $ver），需要 20 或更新版本：https://nodejs.org/zh-cn" }
Write-Host "Node.js $ver"

Step '安装依赖（第一次需要几分钟）'
npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Fail 'npm 安装依赖失败。网络不好时可以试试：build.bat cn' }

Step '编译原生小助手（音乐、系统通知需要）'
$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
$hasSdk = $false
if ($dotnet) { $hasSdk = (dotnet --list-sdks | Select-String '^(8|9|10)\.') -ne $null }
if ($hasSdk) {
  npm run native
  if ($LASTEXITCODE -ne 0) { Fail '原生小助手编译失败' }
} else {
  Write-Host '没有找到 .NET 8 SDK，跳过：打出来的程序能用行情、剪贴板、待办、邮箱，但没有音乐和系统通知。' -ForegroundColor Yellow
  Write-Host '需要的话先安装 .NET 8 SDK（https://dotnet.microsoft.com/zh-cn/download/dotnet/8.0），再重新运行 build.bat。' -ForegroundColor Yellow
}

Step '打包 exe（安装版 + 免安装版）'
npm run dist
if ($LASTEXITCODE -ne 0) { Fail 'electron-builder 打包失败。网络不好时可以试试：build.bat cn' }

$dist = Join-Path $root 'dist'
$portable = Get-ChildItem $dist -Filter 'peek-island-portable-*.exe' | Select-Object -First 1
$setup = Get-ChildItem $dist -Filter 'peek-island-setup-*.exe' | Select-Object -First 1
Write-Host ''
Write-Host '打包完成！' -ForegroundColor Green
if ($portable) { Write-Host "  免安装版（双击直接运行）：$($portable.FullName)" }
if ($setup) { Write-Host "  安装版：$($setup.FullName)" }
Write-Host ''
Start-Process explorer.exe $dist
Read-Host '按回车键关闭'
