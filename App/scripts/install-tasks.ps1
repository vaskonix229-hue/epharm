<#
.SYNOPSIS
  Installer for the Epharm POSM Windows client.

.DESCRIPTION
  The script is designed for a one-click pharmacy deployment:
    1. validates the pharmacy-specific package and posm.json;
    2. copies DEV/PROD to separate versioned folders on local disk;
    3. keeps pharmacy data/config outside the replaceable app directory;
    4. creates a direct interactive scheduled task for the cash-desk user;
    5. creates a one-minute process/UI-heartbeat watchdog;
    6. starts the application and returns success only after a live process and
       a fresh heartbeat have both been observed.

  It is idempotent. Running setup-autostart.bat again repairs/replaces the
  scheduled tasks without deleting media cache or outbox data. A bounded
  handover closes only Epharm POSM processes before the newly installed build
  is started and verified.
#>
[CmdletBinding()]
param(
    # Windows PowerShell 5.1 can evaluate parameter defaults before
    # $PSScriptRoot is initialized. Resolve it explicitly in the script body.
    [string]$SourceDir = "",
    [string]$InstallDir = "C:\Epharm\app",
    [string]$ConfigPath = "",
    [string]$InteractiveUser = "",
    [string]$HeartbeatPath = "C:\Epharm\heartbeat.txt",
    [string]$AppLogPath = "C:\Epharm\customerdisplay.log",
    [int]$MaxHeartbeatAgeSec = 90,
    [int]$StartupTimeoutSec = 90
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$AppTaskName = "EpharmPOSM"
$WatchdogTaskName = "EpharmPOSM-Watchdog"
$InstallRoot = Split-Path -Parent $InstallDir
$InstallLogPath = Join-Path $InstallRoot "install.log"
$StatusPath = Join-Path $InstallRoot "install-status.json"
$DefaultConfigPath = Join-Path $InstallRoot "posm.json"
$TranscriptStarted = $false
$ExitCode = 1
$CurrentPhase = "initialization"

function Write-Step {
    param([string]$Message)
    $script:CurrentPhase = $Message
    Write-Host ("[i] {0}" -f $Message) -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Message)
    Write-Host ("[ok] {0}" -f $Message) -ForegroundColor Green
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Resolve-InteractiveUser {
    param([string]$RequestedUser)

    if (-not [string]::IsNullOrWhiteSpace($RequestedUser)) {
        return $RequestedUser.Trim()
    }

    try {
        $consoleUser = (Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop).UserName
        if (-not [string]::IsNullOrWhiteSpace($consoleUser)) {
            return $consoleUser.Trim()
        }
    } catch { }

    return [Security.Principal.WindowsIdentity]::GetCurrent().Name
}

function Get-AppExe {
    param([string]$Directory)

    foreach ($name in @("CustomerDisplay.exe", "Epharm-POSM.exe")) {
        $candidate = Join-Path $Directory $name
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return [System.IO.Path]::GetFullPath($candidate)
        }
    }

    throw "CustomerDisplay.exe was not found in '$Directory'. The ZIP package is incomplete."
}

function Get-ConfigProperty {
    param(
        [object]$Config,
        [string]$Name
    )

    $property = $Config.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Assert-UpdateManifestPublicKey {
    param([string]$Base64)

    # Keep this public fallback in sync with EpharmConfig. Legacy pharmacy configs
    # omit the field; their signed updater still uses the key embedded in the app.
    $embeddedSpki = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEd/4WWaCXDSf/Vc4dW8cLpJwy/5X8PwPsc87fHgOrAKNTkf3locuDh89KDGzhoB905myQwq9o15vFAeyvyPrLyQ=='
    if ([string]::IsNullOrWhiteSpace($Base64)) {
        $Base64 = $embeddedSpki
    }

    try {
        $keyBytes = [Convert]::FromBase64String($Base64.Trim())
    } catch {
        throw "posm.json UpdateManifestPublicKeySpki is not valid Base64."
    }

    # DER SubjectPublicKeyInfo for an uncompressed ECDSA P-256 point. Windows
    # PowerShell 5.1 cannot import SPKI directly; the POSM client performs the
    # final cryptographic signature check before accepting any release.
    [byte[]]$p256SpkiPrefix = @(
        0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce,
        0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d,
        0x03, 0x01, 0x07, 0x03, 0x42, 0x00, 0x04
    )
    if ($keyBytes.Length -ne 91) {
        throw "posm.json UpdateManifestPublicKeySpki must be an ECDSA P-256 SPKI key."
    }
    for ($i = 0; $i -lt $p256SpkiPrefix.Length; $i++) {
        if ($keyBytes[$i] -ne $p256SpkiPrefix[$i]) {
            throw "posm.json UpdateManifestPublicKeySpki must be an ECDSA P-256 SPKI key."
        }
    }
}

function Read-AndValidateConfig {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Pharmacy config was not found: $Path"
    }

    try {
        $config = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        throw "posm.json is not valid JSON: $($_.Exception.Message)"
    }

    foreach ($required in @(
        "backendBaseUrl",
        "deviceKey",
        "pharmacyId",
        "heartbeatPath",
        "appLogPath"
    )) {
        $value = [string](Get-ConfigProperty -Config $config -Name $required)
        if ([string]::IsNullOrWhiteSpace($value)) {
            throw "posm.json has an empty required field: $required"
        }
    }

    foreach ($requiredFlag in @("enabled", "videoEnabled", "updateEnabled")) {
        $flag = Get-ConfigProperty -Config $config -Name $requiredFlag
        if ($null -eq $flag -or -not [System.Convert]::ToBoolean($flag)) {
            throw "posm.json must contain $requiredFlag=true for a production pharmacy package."
        }
    }

    Assert-UpdateManifestPublicKey ([string](Get-ConfigProperty -Config $config -Name "updateManifestPublicKeySpki"))

    $screenMode = [string](Get-ConfigProperty -Config $config -Name "screenMode")
    $screenMode = $screenMode.Trim().ToLowerInvariant()
    if ($screenMode -notin @("dev", "prod")) {
        throw "posm.json screenMode must be dev or prod."
    }

    $backendText = [string](Get-ConfigProperty -Config $config -Name "backendBaseUrl")
    $backendUri = $null
    if (-not [Uri]::TryCreate($backendText, [UriKind]::Absolute, [ref]$backendUri)) {
        throw "backendBaseUrl is not an absolute URL: $backendText"
    }
    if ($backendUri.Scheme -ne "https" -and -not ($backendUri.Scheme -eq "http" -and $backendUri.IsLoopback)) {
        throw "backendBaseUrl must use HTTPS (HTTP is allowed only for loopback development): $backendText"
    }
    if ($backendUri.AbsolutePath -notin @("", "/")) {
        throw "backendBaseUrl must be an origin without /login or /api path: $backendText"
    }

    $fallbacks = Get-ConfigProperty -Config $config -Name "backendFallbackBaseUrls"
    foreach ($fallbackText in @($fallbacks)) {
        if ([string]::IsNullOrWhiteSpace([string]$fallbackText)) { continue }
        $fallbackUri = $null
        if (-not [Uri]::TryCreate([string]$fallbackText, [UriKind]::Absolute, [ref]$fallbackUri)) {
            throw "backendFallbackBaseUrls contains an invalid URL: $fallbackText"
        }
        if (($fallbackUri.Scheme -ne "https" -and -not ($fallbackUri.Scheme -eq "http" -and $fallbackUri.IsLoopback)) -or
            $fallbackUri.AbsolutePath -notin @("", "/")) {
            throw "backend fallback must be an HTTPS origin (HTTP only for loopback) without /login or /api path: $fallbackText"
        }
    }

    return $config
}

function Get-PackageVersion {
    param([string]$Directory)

    $depsPath = Join-Path $Directory "CustomerDisplay.deps.json"
    if (-not (Test-Path -LiteralPath $depsPath -PathType Leaf)) {
        throw "CustomerDisplay.deps.json is missing from the ZIP package."
    }

    try {
        $deps = Get-Content -LiteralPath $depsPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $libraryName = @($deps.libraries.PSObject.Properties.Name) |
            Where-Object { $_ -like "CustomerDisplay/*" } |
            Select-Object -First 1
        $version = ([string]$libraryName -split "/", 2)[1]
        if ([string]::IsNullOrWhiteSpace($version) -or $version -notmatch "^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$") {
            throw "invalid CustomerDisplay package version"
        }
        return $version
    } catch {
        throw "Could not read the POSM version from CustomerDisplay.deps.json: $($_.Exception.Message)"
    }
}

function Test-PackageContentMatches {
    param(
        [string]$Source,
        [string]$Target
    )

    try {
        $sourceExe = Get-AppExe -Directory $Source
        $targetExe = Get-AppExe -Directory $Target
        if ((Get-FileHash -LiteralPath $sourceExe -Algorithm SHA256).Hash -ne
            (Get-FileHash -LiteralPath $targetExe -Algorithm SHA256).Hash) {
            return $false
        }

        foreach ($fileName in @(
            "CustomerDisplay.dll",
            "CustomerDisplay.deps.json",
            "CustomerDisplay.runtimeconfig.json",
            "watchdog.ps1",
            "install-tasks.ps1"
        )) {
            $sourceFile = Join-Path $Source $fileName
            $targetFile = Join-Path $Target $fileName
            if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf) -or
                -not (Test-Path -LiteralPath $targetFile -PathType Leaf)) {
                return $false
            }
            $sourceHash = (Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash
            $targetHash = (Get-FileHash -LiteralPath $targetFile -Algorithm SHA256).Hash
            if ($sourceHash -ne $targetHash) {
                return $false
            }
        }
        return $true
    } catch {
        return $false
    }
}

function Install-VersionedApplicationFiles {
    param(
        [string]$From,
        [string]$Root,
        [string]$Version,
        [ValidateSet("dev", "prod")]
        [string]$Mode
    )

    $modeLabel = $Mode.ToUpperInvariant()
    $versionRoot = Join-Path $Root ("app-{0}" -f $Mode)
    $target = Join-Path $versionRoot $Version
    New-Item -ItemType Directory -Path $versionRoot -Force | Out-Null

    if (Test-Path -LiteralPath $target -PathType Container) {
        if (Test-PackageContentMatches -Source $From -Target $target) {
            Write-Ok "Verified $modeLabel version $Version already exists on C:; reusing $target"
            return $target
        }

        $matchingRepair = Get-ChildItem -LiteralPath $versionRoot -Directory -Filter "$Version-repair-*" -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTimeUtc -Descending |
            Where-Object { Test-PackageContentMatches -Source $From -Target $_.FullName } |
            Select-Object -First 1
        if ($null -ne $matchingRepair) {
            Write-Ok "Verified repaired $modeLabel version $Version already exists on C:; reusing $($matchingRepair.FullName)"
            return $matchingRepair.FullName
        }

        $target = Join-Path $versionRoot ("{0}-repair-{1}" -f $Version, (Get-Date -Format "yyyyMMddHHmmssfff"))
        Write-Warning "The existing local $modeLabel folder differs from this package; installing the verified copy into $target"
    }

    $staging = $target + ".installing"
    if (Test-Path -LiteralPath $staging) {
        Remove-Item -LiteralPath $staging -Recurse -Force
    }
    New-Item -ItemType Directory -Path $staging -Force | Out-Null

    $sourceFull = [System.IO.Path]::GetFullPath($From).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
    $robocopy = Join-Path $env:SystemRoot "System32\robocopy.exe"
    Write-Host "    Source:      $sourceFull" -ForegroundColor DarkGray
    Write-Host "    Destination: $target" -ForegroundColor DarkGray
    & $robocopy $sourceFull $staging "/E" "/COPY:DAT" "/DCOPY:DAT" "/R:2" "/W:1" "/NFL" "/NDL" "/NJH" "/NJS" "/NP" | Out-Null
    $copyCode = $LASTEXITCODE
    if ($copyCode -gt 7) {
        throw "Failed to copy the $modeLabel package to local disk. Robocopy exit code: $copyCode"
    }

    [void](Get-AppExe -Directory $staging)
    foreach ($required in @(
        "CustomerDisplay.dll",
        "CustomerDisplay.deps.json",
        "CustomerDisplay.runtimeconfig.json",
        "watchdog.ps1",
        "install-tasks.ps1"
    )) {
        if (-not (Test-Path -LiteralPath (Join-Path $staging $required) -PathType Leaf)) {
            throw "The local $modeLabel copy is incomplete: $required is missing."
        }
    }

    Move-Item -LiteralPath $staging -Destination $target
    Write-Ok "$modeLabel version $Version copied to local disk: $target"
    return $target
}

function Grant-InteractiveUserAccess {
    param(
        [string]$Root,
        [string]$UserName
    )

    $icacls = Join-Path $env:SystemRoot "System32\icacls.exe"
    $grant = "{0}:(OI)(CI)M" -f $UserName
    # The inheritable ACE on C:\Epharm covers the newly installed app and data
    # directories without traversing a potentially large extracted source ZIP.
    & $icacls $Root "/grant" $grant "/C" "/Q" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not grant Modify access on $Root to $UserName. icacls exit code: $LASTEXITCODE"
    }
}

function Wait-ForProcess {
    param(
        [string]$ExePath,
        [int]$TimeoutSec
    )

    $expectedPath = [System.IO.Path]::GetFullPath($ExePath)
    $name = [System.IO.Path]::GetFileNameWithoutExtension($expectedPath)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    do {
        foreach ($process in @(Get-Process -Name $name -ErrorAction SilentlyContinue)) {
            try {
                if ([System.IO.Path]::GetFullPath($process.Path) -ieq $expectedPath) {
                    return $process
                }
            } catch { }
        }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)

    return $null
}

function Get-EpharmPosmProcesses {
    return @(
        Get-Process -Name "CustomerDisplay", "Epharm-POSM" -ErrorAction SilentlyContinue
    )
}

function Stop-EpharmPosmProcesses {
    param([int]$GraceSec = 5)

    $processes = @(Get-EpharmPosmProcesses)
    if ($processes.Count -eq 0) {
        return
    }

    Write-Host ("    Controlled handover: closing {0} existing Epharm POSM process(es)." -f $processes.Count) -ForegroundColor DarkGray
    foreach ($process in $processes) {
        try { [void]$process.CloseMainWindow() } catch { }
    }

    $deadline = (Get-Date).AddSeconds($GraceSec)
    do {
        $remaining = @($processes | Where-Object { $null -ne (Get-Process -Id $_.Id -ErrorAction SilentlyContinue) })
        if ($remaining.Count -eq 0) {
            return
        }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)

    foreach ($process in $remaining) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 1

    $stillRunning = @($remaining | Where-Object { $null -ne (Get-Process -Id $_.Id -ErrorAction SilentlyContinue) })
    if ($stillRunning.Count -gt 0) {
        throw "Could not stop the previous Epharm POSM process within the bounded handover timeout."
    }
}

function Wait-ForFreshHeartbeat {
    param(
        [string]$Path,
        [int]$ProcessId,
        [datetime]$NotBeforeUtc,
        [int]$TimeoutSec
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    do {
        $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
        if ($null -eq $process) {
            throw "POSM exited before writing its heartbeat. Check C:\Epharm\crash.log and $AppLogPath"
        }

        if (Test-Path -LiteralPath $Path -PathType Leaf) {
            $heartbeat = Get-Item -LiteralPath $Path
            if ($heartbeat.LastWriteTimeUtc -ge $NotBeforeUtc.AddSeconds(-2)) {
                return $heartbeat
            }
        }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)

    throw "POSM process started but no fresh heartbeat appeared in $TimeoutSec seconds. Check $AppLogPath"
}

function Write-InstallStatus {
    param(
        [string]$Status,
        [string]$Message,
        [string]$Phase = "",
        [string]$UserName = "",
        [string]$PharmacyId = "",
        [string]$ExePath = ""
    )

    try {
        $statusObject = [ordered]@{
            status = $Status
            phase = $Phase
            message = $Message
            installedAt = [DateTimeOffset]::Now.ToString("o")
            interactiveUser = $UserName
            pharmacyId = $PharmacyId
            executable = $ExePath
        }
        $statusObject | ConvertTo-Json | Set-Content -LiteralPath $StatusPath -Encoding UTF8
    } catch { }
}

if (-not (Test-IsAdministrator)) {
    Write-Error "Administrator rights are required. Run setup-autostart.bat and accept the UAC prompt."
    exit 5
}

New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
try {
    Start-Transcript -Path $InstallLogPath -Append -Force | Out-Null
    $TranscriptStarted = $true
} catch { }

try {
    if ([string]::IsNullOrWhiteSpace($SourceDir)) {
        if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
            $SourceDir = $PSScriptRoot
        } elseif (-not [string]::IsNullOrWhiteSpace($MyInvocation.MyCommand.Path)) {
            $SourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
        } else {
            throw "Could not determine the folder containing install-tasks.ps1."
        }
    }
    $SourceDir = [System.IO.Path]::GetFullPath($SourceDir)
    $InstallDir = [System.IO.Path]::GetFullPath($InstallDir)
    if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
        $ConfigPath = Join-Path $SourceDir "posm.json"
    }
    $ConfigPath = [System.IO.Path]::GetFullPath($ConfigPath)

    Write-Step "Validating the pharmacy package."
    [void](Get-AppExe -Directory $SourceDir)
    if (-not (Test-Path -LiteralPath (Join-Path $SourceDir "watchdog.ps1") -PathType Leaf)) {
        throw "watchdog.ps1 is missing from the ZIP package."
    }
    $config = Read-AndValidateConfig -Path $ConfigPath
    $isDevMode = ([string](Get-ConfigProperty -Config $config -Name "screenMode")).Trim().ToLowerInvariant() -eq "dev"
    $pharmacyId = [string](Get-ConfigProperty -Config $config -Name "pharmacyId")
    $backendUrl = [string](Get-ConfigProperty -Config $config -Name "backendBaseUrl")
    $HeartbeatPath = [string](Get-ConfigProperty -Config $config -Name "heartbeatPath")
    $AppLogPath = [string](Get-ConfigProperty -Config $config -Name "appLogPath")
    $InteractiveUser = Resolve-InteractiveUser -RequestedUser $InteractiveUser
    if ([string]::IsNullOrWhiteSpace($InteractiveUser)) {
        throw "Could not determine the currently logged-on Windows user."
    }
    Write-Ok "Package config: pharmacy=$pharmacyId, backend=$backendUrl, user=$InteractiveUser"

    $screenMode = if ($isDevMode) { "dev" } else { "prod" }
    $modeLabel = $screenMode.ToUpperInvariant()
    Write-Step "Copying the $modeLabel package to a verified versioned folder on local disk."
    $packageVersion = Get-PackageVersion -Directory $SourceDir
    $InstallDir = Install-VersionedApplicationFiles -From $SourceDir -Root $InstallRoot -Version $packageVersion -Mode $screenMode

    $exePath = Get-AppExe -Directory $InstallDir
    $exeName = [System.IO.Path]::GetFileName($exePath)
    $watchdogPath = Join-Path $InstallDir "watchdog.ps1"

    Write-Step "Installing the pharmacy config and filesystem permissions."
    $configTemp = $DefaultConfigPath + ".installing"
    Copy-Item -LiteralPath $ConfigPath -Destination $configTemp -Force
    [void](Read-AndValidateConfig -Path $configTemp)
    Copy-Item -LiteralPath $configTemp -Destination $DefaultConfigPath -Force
    Remove-Item -LiteralPath $configTemp -Force -ErrorAction SilentlyContinue
    Write-Ok "Pharmacy config installed into $DefaultConfigPath"

    foreach ($dataDir in @(
        (Join-Path $InstallRoot "media-cache"),
        (Join-Path $InstallRoot "updates")
    )) {
        New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    }
    Grant-InteractiveUserAccess -Root $InstallRoot -UserName $InteractiveUser
    Write-Ok "Filesystem access granted to $InteractiveUser"

    foreach ($legacyFile in @(
        "start-posm.ps1",
        "start-posm-hidden.vbs",
        "watchdog-hidden.vbs"
    )) {
        Remove-Item -LiteralPath (Join-Path $InstallDir $legacyFile) -Force -ErrorAction SilentlyContinue
    }

    Write-Step "Registering automatic startup and watchdog tasks."
    foreach ($taskName in @($AppTaskName, $WatchdogTaskName)) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    }
    $appAction = New-ScheduledTaskAction -Execute $exePath -WorkingDirectory $InstallDir
    $appTrigger = New-ScheduledTaskTrigger -AtLogOn -User $InteractiveUser
    $appPrincipal = New-ScheduledTaskPrincipal -UserId $InteractiveUser -LogonType Interactive -RunLevel Highest
    $appSettingsParams = @{
        AllowStartIfOnBatteries = $true
        DontStopIfGoingOnBatteries = $true
        RestartInterval = (New-TimeSpan -Minutes 1)
        RestartCount = 999
        ExecutionTimeLimit = (New-TimeSpan -Seconds 0)
        MultipleInstances = "IgnoreNew"
        StartWhenAvailable = $true
    }
    $appSettings = New-ScheduledTaskSettingsSet @appSettingsParams
    Register-ScheduledTask -TaskName $AppTaskName -Action $appAction -Trigger $appTrigger -Principal $appPrincipal -Settings $appSettings -Force | Out-Null
    Write-Ok "Task $AppTaskName registered with a direct $exeName action."

    $powerShellExe = Join-Path $PSHOME "powershell.exe"
    $watchdogArgs = (
        '-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" ' +
        '-ExePath "{1}" -ConfigPath "{2}" -HeartbeatPath "{3}" -AppLogPath "{4}" ' +
        '-ScreenMode "{5}" -MaxAgeSec {6} -TaskName "{7}"'
    ) -f $watchdogPath, $exePath, $DefaultConfigPath, $HeartbeatPath, $AppLogPath, $screenMode, $MaxHeartbeatAgeSec, $AppTaskName
    $watchdogLauncher = Join-Path $InstallDir "watchdog-hidden.vbs"
    $watchdogCommand = ('"{0}" {1}' -f $powerShellExe, $watchdogArgs)
    $watchdogCommandForVbs = $watchdogCommand.Replace('"', '""')
    $watchdogVbs = "Set shell = CreateObject(""WScript.Shell"")`r`n" +
                   "shell.Run ""$watchdogCommandForVbs"", 0, False`r`n"
    [System.IO.File]::WriteAllText($watchdogLauncher, $watchdogVbs, [System.Text.UTF8Encoding]::new($false))

    # A recurring task that directly starts powershell.exe can briefly flash a console even with
    # -WindowStyle Hidden. WScript creates the PowerShell process with SW_HIDE from the start.
    $wscriptExe = Join-Path $env:SystemRoot "System32\wscript.exe"
    $watchdogAction = New-ScheduledTaskAction -Execute $wscriptExe -Argument "`"$watchdogLauncher`"" -WorkingDirectory $InstallDir
    $watchdogLogonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $InteractiveUser
    $watchdogRecurringTrigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
    $watchdogSettingsParams = @{
        AllowStartIfOnBatteries = $true
        DontStopIfGoingOnBatteries = $true
        ExecutionTimeLimit = (New-TimeSpan -Minutes 5)
        MultipleInstances = "IgnoreNew"
        StartWhenAvailable = $true
        Hidden = $true
    }
    $watchdogSettings = New-ScheduledTaskSettingsSet @watchdogSettingsParams
    Register-ScheduledTask -TaskName $WatchdogTaskName -Action $watchdogAction -Trigger @($watchdogLogonTrigger, $watchdogRecurringTrigger) -Principal $appPrincipal -Settings $watchdogSettings -Force | Out-Null
    Write-Ok "Task $WatchdogTaskName registered with a fully hidden launcher (every minute and at logon)."

    try {
        Add-Type -AssemblyName System.Windows.Forms
        $monitorCount = [System.Windows.Forms.Screen]::AllScreens.Count
        if ($isDevMode) {
            Write-Ok "DEV mode uses a window on the primary monitor; detected monitors: $monitorCount."
        } elseif ($monitorCount -lt 2) {
            Write-Warning "Windows detects only $monitorCount monitor. POSM will run in pharmacist-only mode: the customer video/receipt screen stays hidden, while scan-triggered recommendations remain active on the primary monitor."
        } else {
            Write-Ok "Windows detects $monitorCount monitors."
        }
    } catch {
        Write-Warning "Monitor count could not be checked. POSM installation will continue: $($_.Exception.Message)"
    }

    Write-Step "Switching to the installed POSM build and validating its process and UI heartbeat."
    Stop-EpharmPosmProcesses -GraceSec 5
    Remove-Item -LiteralPath $HeartbeatPath -Force -ErrorAction SilentlyContinue
    $startedAtUtc = (Get-Date).ToUniversalTime()
    Start-ScheduledTask -TaskName $AppTaskName
    $process = Wait-ForProcess -ExePath $exePath -TimeoutSec $StartupTimeoutSec
    if ($null -eq $process) {
        $taskInfo = Get-ScheduledTaskInfo -TaskName $AppTaskName -ErrorAction SilentlyContinue
        $lastResult = if ($null -ne $taskInfo) { $taskInfo.LastTaskResult } else { "unknown" }
        throw "$exeName did not start in $StartupTimeoutSec seconds. Scheduled task result: $lastResult"
    }
    Write-Ok "$exeName is running from the expected path (PID=$($process.Id))."

    $heartbeat = Wait-ForFreshHeartbeat -Path $HeartbeatPath -ProcessId $process.Id -NotBeforeUtc $startedAtUtc -TimeoutSec $StartupTimeoutSec
    Write-Ok "Fresh UI heartbeat received at $($heartbeat.LastWriteTime)."

    Write-Ok "$modeLabel startup verified. Standard-N log discovery continues inside POSM without delaying setup."
    Start-ScheduledTask -TaskName $WatchdogTaskName -ErrorAction SilentlyContinue

    Start-Sleep -Seconds 3
    if ($null -eq (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) {
        throw "$exeName exited during the final stability check."
    }

    $autoLogon = ""
    try {
        $autoLogon = [string](Get-ItemProperty -LiteralPath "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" -Name "AutoAdminLogon" -ErrorAction Stop).AutoAdminLogon
    } catch { }
    if ($autoLogon -ne "1") {
        Write-Warning "Windows automatic logon is not enabled. POSM starts automatically after the cash-desk user signs in; Windows cannot show desktop software before a user session exists."
    }

    $successMessage = "$modeLabel POSM installed; exact executable path and heartbeat verified. Standard-N log discovery is running in the client."
    Write-InstallStatus -Status "ok" -Phase $CurrentPhase -Message $successMessage -UserName $InteractiveUser -PharmacyId $pharmacyId -ExePath $exePath
    Write-Host ""
    Write-Host "Epharm POSM installation completed successfully." -ForegroundColor Green
    Write-Host "Installed app: $exePath" -ForegroundColor Green
    Write-Host "Config:        $DefaultConfigPath" -ForegroundColor Green
    Write-Host "Log:           $AppLogPath" -ForegroundColor Green
    Write-Host "The setup console can close; POSM is owned by Windows Task Scheduler." -ForegroundColor Green
    $ExitCode = 0
} catch {
    $message = $_.Exception.Message
    Write-InstallStatus -Status "error" -Phase $CurrentPhase -Message $message -UserName $InteractiveUser
    Write-Host ""
    Write-Host ("INSTALLATION FAILED during '{0}': {1}" -f $CurrentPhase, $message) -ForegroundColor Red
    Write-Host "Diagnostic log: $InstallLogPath" -ForegroundColor Yellow
    $ExitCode = 1
} finally {
    if ($TranscriptStarted) {
        try { Stop-Transcript | Out-Null } catch { }
    }
}

exit $ExitCode
