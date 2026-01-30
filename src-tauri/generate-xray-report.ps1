param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$ImageName,
    [Parameter(Mandatory = $false, Position = 1)]
    [string]$OutputPath
)

# Provide the full image path to generate the xray report.

$JsonFile = if ($OutputPath) { $OutputPath } else { "detailed_report.json" }
$jsonDir = Split-Path -Parent $JsonFile
if ($jsonDir -and -not (Test-Path $jsonDir)) {
    New-Item -ItemType Directory -Path $jsonDir -Force | Out-Null
}

function Require-Command([string]$Name, [string]$Display) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Write-Host "$Display is required but it's not installed. Please install $Display." -ForegroundColor Red
        exit 1
    }
}

Require-Command "docker" "Docker"
Require-Command "jf" "JFrog CLI"

# Split up ImageName (tag is after the last ':' that appears after the last '/')
$withoutTag = $ImageName
$tag = ""
$lastColon = $ImageName.LastIndexOf(":")
$lastSlash = $ImageName.LastIndexOf("/")
if ($lastColon -gt -1 -and $lastColon -gt $lastSlash) {
    $tag = $ImageName.Substring($lastColon + 1)
    $withoutTag = $ImageName.Substring(0, $lastColon)
}
$lastRepoSlash = $withoutTag.LastIndexOf("/")
$repository = if ($lastRepoSlash -gt -1) { $withoutTag.Substring($lastRepoSlash + 1) } else { $withoutTag }

Write-Host "Pulling image..."
& docker pull --quiet $ImageName | Out-Null

try {
    $scanJson = & jf docker scan $ImageName --format=simple-json
    [System.IO.File]::WriteAllText($JsonFile, $scanJson, (New-Object System.Text.UTF8Encoding($false)))
} catch {
    Write-Host "Failed to write scan output: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "Removing image..."
& docker image rm $ImageName | Out-Null

# Read and update JSON with totals and image details
$jsonText = Get-Content -Raw -Path $JsonFile
if (-not $jsonText) {
    Write-Host "Scan output is empty; cannot parse JSON." -ForegroundColor Red
    exit 1
}
$json = $jsonText | ConvertFrom-Json

$vuls = @()
if ($null -ne $json.vulnerabilities) { $vuls = @($json.vulnerabilities) }

function Count-Unique-Cves([object[]]$items) {
    if (-not $items) { return 0 }
    $ids = @()
    foreach ($v in $items) {
        if ($null -ne $v.cves) {
            foreach ($c in $v.cves) {
                if ($null -ne $c.id) { $ids += $c.id }
            }
        }
    }
    return ($ids | Sort-Object -Unique).Count
}

$criticalCount = Count-Unique-Cves ($vuls | Where-Object { $_.severity -eq "Critical" })
$highCount = Count-Unique-Cves ($vuls | Where-Object { $_.severity -eq "High" })
$mediumCount = Count-Unique-Cves ($vuls | Where-Object { $_.severity -eq "Medium" })
$lowCount = Count-Unique-Cves ($vuls | Where-Object { $_.severity -eq "Low" })
$infoCount = Count-Unique-Cves ($vuls | Where-Object { $_.severity -eq "Info" })
$unknownCount = Count-Unique-Cves ($vuls | Where-Object { $_.severity -eq "Unknown" })

$json | Add-Member -NotePropertyName "total_vulnerabilities" -NotePropertyValue @{
    critical = [int]$criticalCount
    high = [int]$highCount
    medium = [int]$mediumCount
    low = [int]$lowCount
    info = [int]$infoCount
    unknown = [int]$unknownCount
} -Force

$json | Add-Member -NotePropertyName "image_details" -NotePropertyValue @{
    repository = $repository
    tag = $tag
} -Force

$jsonOut = $json | ConvertTo-Json -Depth 100
[System.IO.File]::WriteAllText($JsonFile, $jsonOut, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ""
Write-Host "Detailed json result created $JsonFile"
Write-Host "Total Vulnerabilities by Severity:"
Write-Host "Critical: $criticalCount"
Write-Host "High: $highCount"
Write-Host "Medium: $mediumCount"
Write-Host "Low: $lowCount"
Write-Host "Info: $infoCount"
Write-Host "Unknown: $unknownCount"
