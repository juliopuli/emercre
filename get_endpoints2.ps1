$jsonString = Get-Content -Raw "aemet_api.json"
$regex = '\"(/api/[^\"]+)\":\{'
$matches = [regex]::Matches($jsonString, $regex)

$uniqueEndpoints = @{}
foreach ($match in $matches) {
    $uniqueEndpoints[$match.Groups[1].Value] = $true
}

foreach ($key in $uniqueEndpoints.Keys | Sort-Object) {
    if ($key -match "satelite|signi|mapa|radar|masas") {
        Write-Host $key
    }
}
