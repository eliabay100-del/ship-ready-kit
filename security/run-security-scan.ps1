<#
.SYNOPSIS
  Runs every security scanner that is installed and writes machine-readable evidence.

.DESCRIPTION
  Missing tools are reported as SKIP, not as PASS. A non-zero exit from a scanner
  is treated as "findings or error" and surfaced in the summary.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File security/run-security-scan.ps1 -Repo . -Url https://staging.example.com -FailOnHigh

.EXAMPLE
  pwsh security/run-security-scan.ps1 -Repo . -Image myapp:latest -FailOnHigh
#>
param(
  [string]$Repo = ".",
  [string]$Image = "",
  [string]$Url = "",
  [string]$OutDir = "security/reports",
  [switch]$FailOnHigh
)

$ErrorActionPreference = "Continue"
$Repo = (Resolve-Path $Repo).Path
if (-not [System.IO.Path]::IsPathRooted($OutDir)) { $OutDir = Join-Path $Repo $OutDir }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$script:results = @()

function Test-Tool([string]$name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Add-Result([string]$tool, [string]$status, [string]$detail) {
  $script:results += [pscustomobject]@{ Tool = $tool; Status = $status; Detail = $detail }
  $color = switch ($status) { "PASS" { "Green" } "FAIL" { "Red" } "SKIP" { "Yellow" } default { "Gray" } }
  Write-Host ("[{0}] {1} - {2}" -f $status, $tool, $detail) -ForegroundColor $color
}

function Invoke-Scan([string]$tool, [string]$exe, [string[]]$arguments, [string]$reportName) {
  if (-not (Test-Tool $exe)) {
    Add-Result $tool "SKIP" "$exe is not installed"
    return
  }
  $report = Join-Path $OutDir $reportName
  Write-Host "`n> $exe $($arguments -join ' ')"
  & $exe @arguments 2>&1 | Tee-Object -FilePath $report | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Add-Result $tool "PASS" "no findings (see $report)"
  } else {
    Add-Result $tool "FAIL" "exit $LASTEXITCODE - review $report"
  }
}

Write-Host "Ship-ready security scan"
Write-Host "repo: $Repo"
Write-Host "out:  $OutDir`n"

# --- Secrets ---------------------------------------------------------------
if (Test-Tool "gitleaks") {
  Invoke-Scan "gitleaks" "gitleaks" @("detect", "--source", $Repo, "--report-format", "json", "--report-path", (Join-Path $OutDir "gitleaks.json"), "--no-banner", "--redact") "gitleaks.log"
} else {
  Add-Result "gitleaks" "SKIP" "install: https://github.com/gitleaks/gitleaks"
}

# --- Dependencies ----------------------------------------------------------
$locks = @(Get-ChildItem -Path $Repo -Filter package-lock.json -Recurse -Depth 3 -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'node_modules' })

if ($locks.Count -eq 0) {
  Add-Result "npm audit" "SKIP" "no package-lock.json found"
} elseif (-not (Test-Tool "npm")) {
  Add-Result "npm audit" "SKIP" "npm is not installed"
} else {
  foreach ($lock in $locks) {
    $label = Split-Path (Split-Path $lock.FullName -Parent) -Leaf
    Push-Location $lock.DirectoryName
    $audit = Join-Path $OutDir "npm-audit-$label.json"
    npm audit --omit=dev --json 2>&1 | Out-File -FilePath $audit -Encoding utf8
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -eq 0) { Add-Result "npm audit ($label)" "PASS" "no prod vulnerabilities" }
    else { Add-Result "npm audit ($label)" "FAIL" "vulnerabilities found - see npm-audit-$label.json" }
  }
}

if (Test-Tool "osv-scanner") {
  Invoke-Scan "osv-scanner" "osv-scanner" @("scan", "source", "-r", $Repo, "--format", "json", "--output", (Join-Path $OutDir "osv.json")) "osv.log"
} else {
  Add-Result "osv-scanner" "SKIP" "install: https://google.github.io/osv-scanner/"
}

# --- SAST ------------------------------------------------------------------
if (Test-Tool "semgrep") {
  Invoke-Scan "semgrep" "semgrep" @("scan", "--config", "auto", "--json", "--output", (Join-Path $OutDir "semgrep.json"), "--quiet", $Repo) "semgrep.log"
} else {
  Add-Result "semgrep" "SKIP" "install: pipx install semgrep"
}

# --- Filesystem / containers / IaC ----------------------------------------
if (Test-Tool "trivy") {
  Invoke-Scan "trivy fs" "trivy" @("fs", "--scanners", "vuln,secret,misconfig", "--format", "json", "--output", (Join-Path $OutDir "trivy-fs.json"), "--quiet", $Repo) "trivy-fs.log"
  if ($Image) {
    Invoke-Scan "trivy image" "trivy" @("image", "--severity", "CRITICAL,HIGH", "--format", "json", "--output", (Join-Path $OutDir "trivy-image.json"), "--quiet", $Image) "trivy-image.log"
  }
} else {
  Add-Result "trivy" "SKIP" "install: https://trivy.dev"
}

if (Test-Tool "checkov") {
  Invoke-Scan "checkov" "checkov" @("-d", $Repo, "-o", "json", "--output-file-path", $OutDir, "--quiet", "--compact") "checkov.log"
} else {
  Add-Result "checkov" "SKIP" "install: pipx install checkov"
}

# --- SBOM ------------------------------------------------------------------
if (Test-Tool "syft") {
  Invoke-Scan "syft" "syft" @($Repo, "-o", "cyclonedx-json=" + (Join-Path $OutDir "sbom.cdx.json"), "--quiet") "syft.log"
} else {
  Add-Result "syft" "SKIP" "install: https://github.com/anchore/syft"
}

# --- DAST ------------------------------------------------------------------
if ($Url) {
  if (Test-Tool "docker") {
    $zapDir = (Resolve-Path $OutDir).Path
    Invoke-Scan "zap baseline" "docker" @(
      "run", "--rm", "-v", "${zapDir}:/zap/wrk:rw", "ghcr.io/zaproxy/zaproxy:stable",
      "zap-baseline.py", "-t", $Url, "-J", "zap.json", "-r", "zap.html", "-I"
    ) "zap.log"
  } else {
    Add-Result "zap baseline" "SKIP" "docker is required for the ZAP baseline scan"
  }

  if (Test-Tool "testssl") {
    Invoke-Scan "testssl" "testssl" @("--severity", "HIGH", "--jsonfile", (Join-Path $OutDir "testssl.json"), $Url) "testssl.log"
  } else {
    Add-Result "testssl" "SKIP" "install: https://testssl.sh (or use the docker image)"
  }
}

# --- Summary ---------------------------------------------------------------
$summaryPath = Join-Path $OutDir "summary.json"
$script:results | ConvertTo-Json -Depth 4 | Out-File -FilePath $summaryPath -Encoding utf8

Write-Host "`n--- Summary ---"
$script:results | Format-Table -AutoSize

Write-Host "Machine-readable summary: $summaryPath"

$failCount = ($script:results | Where-Object { $_.Status -eq "FAIL" }).Count
$skipCount = ($script:results | Where-Object { $_.Status -eq "SKIP" }).Count
Write-Host "`n$failCount failing, $skipCount skipped."

if ($FailOnHigh -and $failCount -gt 0) {
  Write-Host "Failing the build because -FailOnHigh was set." -ForegroundColor Red
  exit 1
}
exit 0
