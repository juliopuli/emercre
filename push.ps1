$token = ''
$repo = 'juliopuli/emercre'
$files = @('index.html', 'assets/logo_emercre.png', 'assets/favicon.ico')
$commitMsg = "V.6.0.3: Deep linking para notificaciones de chat"

$headers = @{
    Authorization = "token $token"
    Accept        = 'application/vnd.github.v3+json'
    'User-Agent'  = 'Awesome-App'
}

foreach ($file in $files) {
    if (Test-Path $file) {
        Write-Host "Pusing $file..."
        $url = "https://api.github.com/repos/$repo/contents/$file"
        
        # Get current SHA
        try {
            $fileInfo = Invoke-RestMethod -Uri $url -Headers $headers -Method Get
            $sha = $fileInfo.sha
        }
        catch {
            $sha = $null
            Write-Host "File $file does not exist in repo yet or error occurred."
        }

        # Prepare payload
        $content = [Convert]::ToBase64String([IO.File]::ReadAllBytes($file))
        $bodyObj = @{
            message = $commitMsg
            content = $content
        }
        
        if ($sha) {
            $bodyObj["sha"] = $sha
        }

        $body = $bodyObj | ConvertTo-Json -Depth 10

        # Push changes
        try {
            $result = Invoke-RestMethod -Uri $url -Headers $headers -Method Put -Body $body -ContentType 'application/json'
            Write-Host "Success! New SHA for $file : $($result.content.sha)"
        }
        catch {
            Write-Host "Failed to push $file"
            Write-Host $_.Exception.Message
        }
    }
}
