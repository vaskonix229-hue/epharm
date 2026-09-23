# Run with: pwsh -NoProfile -File App.Tests/InstallTasksPreflight.Tests.ps1
# Extract only the pure validation functions: dot-sourcing the installer would
# otherwise create scheduled tasks and start the application.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$installerPath = Join-Path $repoRoot 'App/scripts/install-tasks.ps1'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    $installerPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) {
    throw "Installer has PowerShell parse errors: $($parseErrors[0].Message)"
}

foreach ($name in @('Get-ConfigProperty', 'Assert-UpdateManifestPublicKey', 'Read-AndValidateConfig')) {
    $definition = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
            $node.Name -eq $name
    }, $true)
    if ($null -eq $definition) { throw "Missing installer function: $name" }
    Invoke-Expression $definition.Extent.Text
}

$installerSource = Get-Content -LiteralPath $installerPath -Raw -Encoding UTF8
$configSource = Get-Content -LiteralPath (Join-Path $repoRoot 'App/Config/EpharmConfig.cs') -Raw -Encoding UTF8
$installerKey = [regex]::Match($installerSource, '\$embeddedSpki\s*=\s*''([^'']+)''')
$configKey = [regex]::Match($configSource, 'EmbeddedUpdateManifestPublicKeySpki\s*=\s*"([^"]+)"')
if (-not $installerKey.Success -or -not $configKey.Success -or
    $installerKey.Groups[1].Value -ne $configKey.Groups[1].Value) {
    throw 'Installer fallback SPKI differs from the POSM embedded trust anchor.'
}

# A public, non-production P-256 test key; no signing key or device credential is used.
$validSpki = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEOZlHeHsr6gs5b2p7iF7lq5oSwKGVQnDvFGXxNYQAXZ0ELk6jytl5mxvBAqR9xiv+Mg/5oXBvaM7rd/oQSPoI8w=='
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("epharm-preflight-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempDir | Out-Null
$script:passed = 0

function New-ValidConfig {
    return @{
        enabled = $true
        videoEnabled = $true
        updateEnabled = $true
        backendBaseUrl = 'https://epharm.example.test'
        backendFallbackBaseUrls = @('https://backup.example.test')
        updateManifestPublicKeySpki = $validSpki
        deviceKey = 'test-device-token'
        pharmacyId = 'test-pharmacy'
        heartbeatPath = 'C:\Epharm\heartbeat.txt'
        appLogPath = 'C:\Epharm\app.log'
        screenMode = 'prod'
    }
}

function Test-ConfigCase {
    param(
        [string]$Name,
        [hashtable]$Changes,
        [string]$ExpectedError = ''
    )

    $config = New-ValidConfig
    foreach ($key in $Changes.Keys) { $config[$key] = $Changes[$key] }
    $path = Join-Path $tempDir ("case-$($script:passed).json")
    $config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $path -Encoding UTF8

    $actualError = $null
    try {
        $null = Read-AndValidateConfig -Path $path
    } catch {
        $actualError = $_.Exception.Message
    }
    if ($ExpectedError) {
        if ($null -eq $actualError -or $actualError -notlike "*$ExpectedError*") {
            throw "Unexpected result for ${Name}: expected '$ExpectedError', got '$actualError'"
        }
    } elseif ($null -ne $actualError) {
        throw "Unexpected rejection of ${Name}: $actualError"
    }
    $script:passed++
}

try {
    Test-ConfigCase -Name 'valid HTTPS production config' -Changes @{}
    Test-ConfigCase -Name 'loopback HTTP development config' -Changes @{
        backendBaseUrl = 'http://127.0.0.1:8080'
        backendFallbackBaseUrls = @('http://localhost:8081')
    }
    Test-ConfigCase -Name 'legacy config missing public key uses embedded pin' -Changes @{
        updateManifestPublicKeySpki = $null
    }
    Test-ConfigCase -Name 'blank public key uses embedded pin' -Changes @{
        updateManifestPublicKeySpki = ' '
    }
    Test-ConfigCase -Name 'invalid Base64 public key' -Changes @{
        updateManifestPublicKeySpki = 'not a Base64 key!'
    } -ExpectedError 'not valid Base64'

    [byte[]]$wrongCurve = [Convert]::FromBase64String($validSpki)
    $wrongCurve[22] = 0x08
    Test-ConfigCase -Name 'wrong curve SPKI' -Changes @{
        updateManifestPublicKeySpki = [Convert]::ToBase64String($wrongCurve)
    } -ExpectedError 'ECDSA P-256 SPKI'

    [byte[]]$truncated = ([Convert]::FromBase64String($validSpki))[0..89]
    Test-ConfigCase -Name 'truncated SPKI' -Changes @{
        updateManifestPublicKeySpki = [Convert]::ToBase64String($truncated)
    } -ExpectedError 'ECDSA P-256 SPKI'

    Test-ConfigCase -Name 'remote HTTP primary' -Changes @{
        backendBaseUrl = 'http://epharm.example.test:8060'
    } -ExpectedError 'must use HTTPS'
    Test-ConfigCase -Name 'remote HTTP fallback' -Changes @{
        backendFallbackBaseUrls = @('https://backup.example.test', 'http://fallback.example.test:8060')
    } -ExpectedError 'must be an HTTPS origin'

    Write-Host "POSM installer preflight passed: $script:passed cases."
} finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force
}
