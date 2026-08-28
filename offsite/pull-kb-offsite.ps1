# Offsite pull: fetch the latest personal-knowledge-web backup snapshot from the
# Tencent Cloud host into E:\Backups\personal-knowledge-web, verify SHA256SUMS,
# keep the newest 8 snapshots. Runs daily via Task Scheduler ("KB offsite backup pull").
# The server-side snapshot dir is root-only (0700), so files stream through
# `ssh sudo tar` rather than plain scp.
$ErrorActionPreference = 'Stop'
$destRoot = 'E:\Backups\personal-knowledge-web'
$log      = Join-Path $destRoot 'pull.log'

function Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m" | Add-Content -Path $log }
New-Item -ItemType Directory -Force -Path $destRoot | Out-Null

try {
    $latest = (ssh -o BatchMode=yes tencent-cloud "sudo ls -1 /var/backups/personal-knowledge-web | sort | tail -1" | Select-Object -Last 1).Trim()
    if ($latest -notmatch '^\d{8}T\d{6}Z$') { throw "unexpected snapshot name: '$latest'" }

    $dest = Join-Path $destRoot $latest
    if (Test-Path (Join-Path $dest 'SHA256SUMS')) { Log "SKIP $latest already present"; exit 0 }
    if (Test-Path $dest) { Log "CLEAN partial dir from previous failed pull"; Remove-Item -Recurse -Force -LiteralPath $dest }
    # remote tar streams the dir entry itself, so extract into $destRoot and let
    # the archive create <stamp>/ (forward slashes, unquoted, to avoid MSYS mangling)
    $cmd = 'ssh -o BatchMode=yes tencent-cloud "sudo tar czf - -C /var/backups/personal-knowledge-web ' + $latest + '" | tar -xzf - -C ' + ($destRoot -replace '\\', '/')
    cmd /c $cmd
    if ($LASTEXITCODE -ne 0) { throw "pull failed (exit $LASTEXITCODE)" }

    Push-Location $dest
    try {
        $ok = $true
        foreach ($line in Get-Content SHA256SUMS) {
            if (-not $line.Trim()) { continue }
            $parts = $line -split '\s+', 2
            $expected = $parts[0].ToLower()
            $file = $parts[1].Trim().TrimStart('*')
            $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLower()
            if ($actual -ne $expected) { Log "FAIL checksum $file"; $ok = $false }
        }
    } finally { Pop-Location }
    if (-not $ok) { throw "checksum verification failed for $latest" }
    Log "OK $latest verified"

    # local retention: keep newest 8 snapshots (~2 weeks at daily cadence)
    Get-ChildItem $destRoot -Directory | Where-Object { $_.Name -match '^\d{8}T\d{6}Z$' } |
        Sort-Object Name -Descending | Select-Object -Skip 8 | ForEach-Object {
            Log "PRUNE $($_.Name)"
            Remove-Item -Recurse -Force -LiteralPath $_.FullName
        }
    exit 0
} catch {
    Log "ERROR $($_.Exception.Message)"
    exit 1
}
