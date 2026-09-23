# publish-exe.ps1 — собирает self-contained .exe POSM-клиента (win-x64) и пакует
# в ZIP для отправки другому разработчику.
#
# ГДЕ ЗАПУСКАТЬ: на Windows с .NET 10 SDK, из КОРНЯ репозитория (где папка App).
# По умолчанию берёт боевой конфиг из C:\Epharm\posm.json (с ключом и прод-URL).
#
#   Set-ExecutionPolicy -Scope Process Bypass -Force
#   .\App\scripts\publish-exe.ps1
#
# Результат: Рабочий стол\Epharm-POSM-v<версия>-win-x64.zip — его и отправляй.
# Получатель распаковывает архив и запускает run.bat или run-kassa.ps1:
# клиентский экран откроется слева в dev-режиме, POSM-логи пойдут в этот же терминал.

param(
  [string]$ConfigPath = "C:\Epharm\posm.json",
  [string]$Version = "1.0.65",
  [string]$OutputDir = "",
  [switch]$KeepPackageFolder
)
$ErrorActionPreference = "Stop"

trap {
  if (-not $KeepPackageFolder -and $out -and (Test-Path $out)) {
    Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($buildRoot -and (Test-Path $buildRoot)) {
    Remove-Item $buildRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  throw $_
}

$sourceRoot = (Get-Location).Path
$sourceProj = Join-Path $sourceRoot "App\CustomerDisplay.csproj"
if (!(Test-Path $sourceProj)) {
  throw "Не найден $sourceProj. Запускай из КОРНЯ репозитория (где лежит папка App)."
}

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  $OutputDir = [Environment]::GetFolderPath("Desktop")
}
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  $OutputDir = $sourceRoot
}
$OutputDir = $OutputDir.Trim()
if ($OutputDir -match "^[A-Za-z]:$") {
  $OutputDir = "$OutputDir\"
}
if (!(Test-Path -LiteralPath $OutputDir)) {
  New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
}
$resolvedOutputDir = Resolve-Path -LiteralPath $OutputDir -ErrorAction SilentlyContinue
if ($resolvedOutputDir) {
  $OutputDir = $resolvedOutputDir.ProviderPath
}

function Invoke-RoboMirror([string]$From, [string]$To) {
  if (Test-Path $To) { Remove-Item $To -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $To | Out-Null
  robocopy $From $To /MIR /XD bin obj /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -gt 7) {
    throw "robocopy завершился с ошибкой ($LASTEXITCODE): $From -> $To"
  }
}

# Публикуем из локального staging в TEMP, а не напрямую из сетевого Z:.
# На Windows/WPF publish из сетевой общей папки иногда падает BG1002/BG1003 по **/*.xaml.
$buildRoot = Join-Path $env:TEMP ("Epharm-POSM-build-{0}" -f $Version)
if (Test-Path $buildRoot) { Remove-Item $buildRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $buildRoot | Out-Null
Invoke-RoboMirror (Join-Path $sourceRoot "App") (Join-Path $buildRoot "App")
Invoke-RoboMirror (Join-Path $sourceRoot "Models") (Join-Path $buildRoot "Models")

$root = $buildRoot
$proj = Join-Path $root "App\CustomerDisplay.csproj"

$packageName = "Epharm-POSM-v$Version-win-x64"
$out = Join-Path $buildRoot $packageName
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force -Path $out | Out-Null

Write-Host "== dotnet publish (self-contained win-x64, может занять пару минут) ==" -ForegroundColor Cyan
dotnet publish $proj -c Release -r win-x64 --self-contained true `
  -p:EnableWindowsTargeting=true -p:Version=$Version -p:DebugType=None -p:DebugSymbols=false -o $out
if ($LASTEXITCODE -ne 0) { throw "dotnet publish завершился с ошибкой." }

# Имя exe НЕ меняем: install-tasks.ps1, watchdog.ps1, авто-апдейтер и документация
# ожидают CustomerDisplay.exe. Старое переименование в Epharm-POSM.exe давало эффект
# «запускается раз через раз»: run.bat мог стартовать одно имя, а scheduled task/watchdog
# искали другое.

# Боевой конфиг рядом с .exe (адрес бэкенда, ключ устройства, id аптеки).
if (Test-Path $ConfigPath) {
  $packageConfig = Join-Path $out "posm.json"
  Copy-Item $ConfigPath $packageConfig -Force
  try {
    $cfg = Get-Content $packageConfig -Raw | ConvertFrom-Json
    Write-Host ("Конфиг скопирован. BackendBaseUrl = {0} | PharmacyId = {1}" -f $cfg.BackendBaseUrl, $cfg.PharmacyId) -ForegroundColor Green
    if ($cfg.BackendBaseUrl -match "localhost|127\.0\.0\.1") {
      Write-Warning "Конфиг смотрит на localhost — для боевого режима поправь BackendBaseUrl в posm.json перед отправкой!"
    }
    Write-Host ("ScreenMode в установочном ZIP сохранён из конфига: {0}. run.bat временно включает dev-режим только для ручного теста." -f $cfg.ScreenMode) -ForegroundColor Green
  } catch { }
} else {
  Write-Warning "Конфиг $ConfigPath не найден — впиши posm.json вручную перед отправкой!"
}

# README, автозапуск и диагностические скрипты для получателя.
$readme = Join-Path $sourceRoot "App\scripts\README-distrib.md"
if (Test-Path $readme) { Copy-Item $readme (Join-Path $out "README.md") -Force }
foreach ($scriptName in @(
  "setup-autostart.bat",
  "install-tasks.ps1",
  "uninstall-tasks.ps1",
  "watchdog.ps1",
  "diagnose-standardn.bat",
  "diagnose-standardn.ps1",
  "collect-posm-diagnostics.bat",
  "collect-posm-diagnostics.ps1",
  "capture-standardn-scan-source.bat",
  "capture-standardn-scan-source.ps1",
  "README-scan-source-capture.txt",
  "THIRD-PARTY-NOTICES-scan-source.txt"
)) {
  $src = Join-Path $sourceRoot "App\scripts\$scriptName"
  if (Test-Path $src) { Copy-Item $src (Join-Path $out $scriptName) -Force }
}

# Лаунчер для тестовой передачи разработчику: подставляет путь к конфигу,
# включает dev-режим (окно слева) и оставляет POSM-логи в этом же терминале.
# EPHARM_LOG_PATH здесь НЕ задаём: в реальном режиме клиент сам слушает стандартные
# пути Стандарт-Н (C:\Standart-N\Kassir\zkassa.log и demo-путь). Override нужен
# только для ручной диагностики конкретной кассы.
$ps1 = @'
$ErrorActionPreference = "Stop"

try {
  chcp 65001 > $null
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
  [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch { }

function Write-NewLogText {
  param(
    [string]$Path
  )

  if (!(Test-Path $Path)) { return }

  try {
    $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
      if ($fs.Length -lt $script:LogPosition) { $script:LogPosition = 0L }
      if ($fs.Length -eq $script:LogPosition) { return }

      [void]$fs.Seek($script:LogPosition, [System.IO.SeekOrigin]::Begin)
      $count = [int]($fs.Length - $script:LogPosition)
      $buffer = New-Object byte[] $count
      $read = $fs.Read($buffer, 0, $count)
      $script:LogPosition = $fs.Position

      if ($read -gt 0) {
        $text = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $read)
        $text = $text.TrimStart([char]0xFEFF)
        if ($text.Length -gt 0) { Write-Host -NoNewline $text }
      }
    } finally {
      $fs.Dispose()
    }
  } catch {
    # На кассе лог может на мгновение быть занят. Следующая итерация дочитает хвост.
  }
}

$root = $PSScriptRoot
$exe = Join-Path $root "CustomerDisplay.exe"
$config = Join-Path $root "posm.json"

if (!(Test-Path $exe)) { throw "Не найден CustomerDisplay.exe: $exe" }
if (!(Test-Path $config)) { throw "Не найден posm.json: $config" }

Write-Host "Останавливаю старые копии CustomerDisplay ..." -ForegroundColor Cyan
Get-Process CustomerDisplay -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path "C:\Epharm" | Out-Null

$env:EPHARM_DEBUG = "1"
$env:EPHARM_SCREEN_MODE = "dev"
$env:EPHARM_POSM_CONFIG = $config
$env:EPHARM_APP_LOG = "C:\Epharm\customerdisplay.log"

if (Test-Path $env:EPHARM_APP_LOG) {
  Remove-Item $env:EPHARM_APP_LOG -Force -ErrorAction SilentlyContinue
}

Write-Host "Конфиг: $env:EPHARM_POSM_CONFIG" -ForegroundColor Green
Write-Host "Лог приложения: $env:EPHARM_APP_LOG" -ForegroundColor Green
Write-Host "Лог Стандарт-Н: использую EPHARM_LOG_PATH, если он задан; иначе автообнаружение и стандартные пути." -ForegroundColor Green
Write-Host "Клиентский экран: dev-режим, окно слева." -ForegroundColor Green
Write-Host ""
Write-Host "Логи POSM ниже. Для остановки закрой окно приложения или нажми Ctrl+C." -ForegroundColor Yellow
Write-Host "======================================================================" -ForegroundColor DarkGray

$proc = Start-Process -FilePath $exe -WorkingDirectory $root -PassThru
Write-Host ("Приложение запущено, PID={0}. Жду появления лога..." -f $proc.Id) -ForegroundColor DarkGray

$script:LogPosition = 0L
$warnedNoLog = $false
$startedAt = Get-Date

try {
  while ($true) {
    $proc.Refresh()
    Write-NewLogText -Path $env:EPHARM_APP_LOG

    if ($proc.HasExited) { break }

    if (!$warnedNoLog -and !(Test-Path $env:EPHARM_APP_LOG) -and ((Get-Date) - $startedAt).TotalSeconds -ge 10) {
      Write-Host "Лог ещё не создан. Если окно POSM не появилось, проверь распаковку архива и Windows Defender/SmartScreen." -ForegroundColor Yellow
      $warnedNoLog = $true
    }

    Start-Sleep -Milliseconds 250
  }

  Write-NewLogText -Path $env:EPHARM_APP_LOG
} finally {
  if ($proc -and !$proc.HasExited) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  }
}

if ($proc.ExitCode -ne 0) {
  throw "CustomerDisplay завершился с кодом $($proc.ExitCode). Смотри лог: $env:EPHARM_APP_LOG"
}

exit 0
'@
[System.IO.File]::WriteAllText(
  (Join-Path $out "run-kassa.ps1"),
  $ps1,
  [System.Text.UTF8Encoding]::new($true))

$bat = @'
@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-kassa.ps1"
if errorlevel 1 pause
'@
Set-Content -Path (Join-Path $out "run.bat") -Value $bat -Encoding Default

# Упаковать в ZIP локально, затем одним файлом перенести в OutputDir.
# Нельзя публиковать/сжимать тысячи self-contained файлов напрямую на Z:\:
# shared-диск UTM/WebDAV делает это в разы медленнее и иногда держит locks.
$zipName = "Epharm-POSM-v{0}-win-x64.zip" -f $Version
$localZip = Join-Path $buildRoot $zipName
$zip = Join-Path $OutputDir $zipName
if (Test-Path $localZip) { Remove-Item $localZip -Force }
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $out "*") -DestinationPath $localZip
Copy-Item $localZip $zip -Force
$sizeMb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
$sha256 = (Get-FileHash -Path $zip -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -Path "$zip.sha256" -Value "$sha256  $zipName" -Encoding ASCII

# Публичный auto-update пакет не должен содержать аптечный posm.json: иначе общий
# релиз перезапишет PharmacyId/DeviceKey каждой кассы. AppUpdater также удаляет такой
# файл из staging для совместимости со старыми, ошибочно собранными архивами.
$updatePackageName = "Epharm-POSM-update-v$Version-win-x64"
$updateOut = Join-Path $buildRoot $updatePackageName
Invoke-RoboMirror $out $updateOut
Remove-Item (Join-Path $updateOut "posm.json") -Force -ErrorAction SilentlyContinue
$updateZipName = "$updatePackageName.zip"
$localUpdateZip = Join-Path $buildRoot $updateZipName
$updateZip = Join-Path $OutputDir $updateZipName
if (Test-Path $localUpdateZip) { Remove-Item $localUpdateZip -Force }
if (Test-Path $updateZip) { Remove-Item $updateZip -Force }
Compress-Archive -Path (Join-Path $updateOut "*") -DestinationPath $localUpdateZip
Copy-Item $localUpdateZip $updateZip -Force
$updateSizeMb = [math]::Round((Get-Item $updateZip).Length / 1MB, 1)
$updateSha256 = (Get-FileHash -Path $updateZip -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -Path "$updateZip.sha256" -Value "$updateSha256  $updateZipName" -Encoding ASCII

# Переходный пакет для уже установленных версий. На кассах уже есть одинаковый
# self-contained .NET/VLC runtime, поэтому достаточно заменить файлы приложения и
# новые управляемые зависимости, которых могло не быть в старом дистрибутиве.
# Это уменьшает первое массовое обновление примерно со 160 МБ до нескольких мегабайт.
$bridgePackageName = "Epharm-POSM-bridge-v$Version-win-x64"
$bridgeOut = Join-Path $buildRoot $bridgePackageName
New-Item -ItemType Directory -Force -Path $bridgeOut | Out-Null
foreach ($bridgeFile in @(
  "CustomerDisplay.exe",
  "CustomerDisplay.dll",
  "CustomerDisplay.deps.json",
  "CustomerDisplay.runtimeconfig.json",
  "QRCoder.dll"
)) {
  $bridgeSource = Join-Path $out $bridgeFile
  if (!(Test-Path $bridgeSource)) { throw "Bridge package: не найден $bridgeFile" }
  Copy-Item $bridgeSource (Join-Path $bridgeOut $bridgeFile) -Force
}
$bridgeZipName = "$bridgePackageName.zip"
$localBridgeZip = Join-Path $buildRoot $bridgeZipName
$bridgeZip = Join-Path $OutputDir $bridgeZipName
if (Test-Path $localBridgeZip) { Remove-Item $localBridgeZip -Force }
if (Test-Path $bridgeZip) { Remove-Item $bridgeZip -Force }
Compress-Archive -Path (Join-Path $bridgeOut "*") -DestinationPath $localBridgeZip
Copy-Item $localBridgeZip $bridgeZip -Force
$bridgeSizeMb = [math]::Round((Get-Item $bridgeZip).Length / 1MB, 1)
$bridgeSha256 = (Get-FileHash -Path $bridgeZip -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -Path "$bridgeZip.sha256" -Value "$bridgeSha256  $bridgeZipName" -Encoding ASCII

if ($KeepPackageFolder) {
  $debugOut = Join-Path $OutputDir $packageName
  if (Test-Path $debugOut) { Remove-Item $debugOut -Recurse -Force }
  Copy-Item $out $debugOut -Recurse -Force
}
Remove-Item $buildRoot -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host ("УСТАНОВОЧНЫЙ ZIP: {0}  ({1} МБ), SHA256={2}" -f $zip, $sizeMb, $sha256) -ForegroundColor Green
Write-Host "Внутри: CustomerDisplay.exe + рантайм + libvlc, posm.json, run-kassa.ps1, run.bat, setup-autostart.bat, install/watchdog/uninstall scripts, README.md." -ForegroundColor Green
Write-Host ("AUTO-UPDATE ZIP: {0}  ({1} МБ), SHA256={2}" -f $updateZip, $updateSizeMb, $updateSha256) -ForegroundColor Green
Write-Host "Auto-update ZIP не содержит posm.json и безопасен для общего релиза через /downloads/." -ForegroundColor Green
Write-Host ("BRIDGE ZIP: {0}  ({1} МБ), SHA256={2}" -f $bridgeZip, $bridgeSizeMb, $bridgeSha256) -ForegroundColor Green
Write-Host "Bridge ZIP предназначен для быстрого перехода установленных старых версий на новый устойчивый updater." -ForegroundColor Green
Write-Host "Для первичной установки распакуй установочный ZIP целиком и запусти setup-autostart.bat либо run.bat для ручного теста." -ForegroundColor Green
