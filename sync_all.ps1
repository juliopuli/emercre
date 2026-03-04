$token = ''
$repo = 'juliopuli/emercre'

$filesToSync = @(
    "index.html",
    "assets/alert.mp3",
    "assets/icons/ambulance.png",
    "assets/icons/offroad.png",
    "assets/icons/truck.png",
    "assets/icons/van.png",
    "assets/logo_emercre.png"
)

foreach ($fileRelPath in $filesToSync) {
    $url = "https://api.github.com/repos/$repo/contents/$fileRelPath"
    $headers = @{
        Authorization = "token $token"
        Accept = 'application/vnd.github.v3+json'
        'User-Agent' = 'Awesome-App'
    }

    Write-Host "Syncing $fileRelPath..."

    # Read local content
    if (-not (Test-Path $fileRelPath)) {
        Write-Host "File $fileRelPath not found locally, skipping."
        continue
    }
    $content = [Convert]::ToBase64String([IO.File]::ReadAllBytes($fileRelPath))

    # Get current SHA (if exists)
    $sha = $null
    try {
        $fileInfo = Invoke-RestMethod -Uri $url -Headers $headers -Method Get -ErrorAction Stop
        $sha = $fileInfo.sha
    } catch {
        Write-Host "File $fileRelPath does not exist on GitHub yet."
    }

    # Prepare payload
    $body = @{
        message = "fix: z-index de autocompletado en mapa arreglado V.5.4.1"
        content = $content
    }
    if ($sha) { $body.sha = $sha }
    $jsonBody = $body | ConvertTo-Json -Depth 10

    # Push changes
    try {
        $result = Invoke-RestMethod -Uri $url -Headers $headers -Method Put -Body $jsonBody -ContentType 'application/json'
        Write-Host "Successfully synced $fileRelPath"
    } catch {
        Write-Host "Failed to sync $fileRelPath"
        Write-Host $_.Exception.Message
    }
}
