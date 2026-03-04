$jsonString = Get-Content -Raw "aemet_api.json"
$regex = '\"(/api/[a-zA-Z0-9_/-]+(satelite|radar|masas|significativos)[a-zA-Z0-9_/-]*)\"'
$matches = [regex]::Matches($jsonString, $regex)

$uniqueEndpoints = @{}
foreach ($match in $matches) {
    $uniqueEndpoints[$match.Groups[1].Value] = $true
}

foreach ($key in $uniqueEndpoints.Keys) {
    Write-Output $key
}
