#requires -Version 5.1
<# Manual existing-production deployment. No GitHub Actions dispatch, local secrets or digest copying. #>
[CmdletBinding()]
param(
    [ValidatePattern('^(latest|[1-9][0-9]{0,19}|[a-f0-9]{40})\z')]
    [string]$Release = 'latest',
    [switch]$Plan,
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9.-]*\z')]
    [string]$SshHost = 'ledger.eruditology.com',
    [ValidateRange(1,65535)]
    [int]$Port = 22,
    [string]$IdentityFile
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ssh = (Get-Command ssh -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$sshOptions = @('-T', '-p', "$Port", '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
                '-o', 'ForwardAgent=no', '-o', 'ClearAllForwardings=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3')
if ($IdentityFile) { $sshOptions += @('-i', (Resolve-Path -LiteralPath $IdentityFile).Path, '-o', 'IdentitiesOnly=yes') }
$target = "ledgerdeploy@$SshHost"
$entry = '/opt/encounter-ledger/current/scripts/ops/deploy-release.sh'
function Invoke-LedgerRemote([string]$Command) {
    # The only interpolated remote values are validated hashes, IDs and selectors.
    $lines = New-Object 'System.Collections.Generic.List[string]'
    # Merge the remote script's safe progress messages on the remote side. This
    # avoids PowerShell 5.1 treating ordinary native stderr as a terminating error.
    & $ssh @sshOptions $target "$Command 2>&1" | ForEach-Object {
        $text = [string]$_
        if ($text.StartsWith('{')) { $lines.Add($text) } else { Write-Host $text }
    }
    if ($LASTEXITCODE -ne 0) { throw 'Remote deployment operation failed. Read its safe stage/snapshot/report message; no automatic rollback is performed.' }
    if ($lines.Count -ne 1) { throw 'Expected one verified JSON response. Inspect the host report before retrying; do not assume nothing changed.' }
    try { return ($lines[0] | ConvertFrom-Json) }
    catch { throw 'Remote response was not valid JSON. Inspect the host report before retrying.' }
}
function Assert-Pattern([object]$Value, [string]$Pattern) {
    if ($Value -isnot [string] -or $Value -cnotmatch $Pattern) { throw 'Malformed deployment plan. Refusing to continue.' }
}
try {
    Write-Host "Checking verified release and existing production on $target ..."
    $proposal = Invoke-LedgerRemote "$entry --plan --release $Release"
    if ($proposal.schemaVersion -ne 1 -or $proposal.origin -cne 'https://ledger.eruditology.com' -or
        $proposal.deploymentRequired -isnot [bool]) { throw 'Unexpected deployment plan or target.' }
    Assert-Pattern $proposal.current.imageId '^sha256:[a-f0-9]{64}\z'
    Assert-Pattern $proposal.current.configurationHash '^[a-f0-9]{64}\z'
    Assert-Pattern $proposal.current.checkoutCommit '^[a-f0-9]{40}\z'
    Assert-Pattern $proposal.current.image '^[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}\z'
    Assert-Pattern $proposal.release.digest '^sha256:[a-f0-9]{64}\z'
    Assert-Pattern $proposal.release.commit '^[a-f0-9]{40}\z'
    Assert-Pattern ([string]$proposal.release.runId) '^[1-9][0-9]{0,19}\z'
    if ($proposal.release.image -cne 'ghcr.io/raycoulstock/dnd-combat-tracker') { throw 'Unexpected image repository.' }
    Write-Host "`nCurrent release:  $($proposal.current.image)"
    Write-Host "Current commit:   $($proposal.current.commit)"
    Write-Host "Proposed release: $($proposal.release.image)@$($proposal.release.digest)"
    Write-Host "GitHub commit:    $($proposal.release.commit)"
    Write-Host "Publication run:  $($proposal.release.runId)"
    Write-Host "Deployment needed: $($proposal.deploymentRequired)"
    if ($Plan) { Write-Host 'Plan only. No image pull, backup, migration or application change was requested.'; return }
    if (-not $proposal.deploymentRequired) { Write-Host 'Already running the approved release. Nothing to deploy.'; return }
    $required = "DEPLOY $($proposal.release.runId)"
    $answer = Read-Host "`nThis will stop application writes for an encrypted backup and migration. Type '$required' to continue (anything else cancels)"
    if ($answer -cne $required) { Write-Host 'Cancelled. No deployment changes requested.'; return }
    $command = "$entry --apply --release $($proposal.release.runId) --expected-current $($proposal.current.imageId) --expected-configuration $($proposal.current.configurationHash) --expected-checkout $($proposal.current.checkoutCommit) --expected-digest $($proposal.release.digest)"
    $result = Invoke-LedgerRemote $command
    if ($result.status -cnotin @('success','unchanged')) { throw 'Deployment did not report success. Inspect the protected host report.' }
    Write-Host "`nDeployment result: $($result.status)"
    if ($result.status -ceq 'success') {
        Write-Host "Image: $($result.release.image)@$($result.release.digest)"
        Write-Host "Backup snapshot: $($result.backupSnapshot)"
        Write-Host "Host report: $($result.report)"
    }
} catch {
    throw $_.Exception.Message
}
