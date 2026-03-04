$apiKey = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJqdWxpb0BjcnV6cm9qYS5lcyIsImp0aSI6ImRmODliOWZmLWYxYmUtNDA0YS05MWNmLTI1ZDNhZmI5Y2E2OCIsImlzcyI6IkFFTUVUIiwiaWF0IjoxNzcyNDc3MzI5LCJ1c2VySWQiOiJkZjg5YjlmZi1mMWJlLTQwNGEtOTFjZi0yNWQzYWZiOWNhNjgiLCJyb2xlIjoiIn0.FzqcUNaEzp7v6rFGBiBB_U13GHOP_on5YdQDEFRr00w'
$urls = @(
    "https://opendata.aemet.es/opendata/api/satelite/producto/infrarrojo",
    "https://opendata.aemet.es/opendata/api/satelite/producto/masas-aire",
    "https://opendata.aemet.es/opendata/api/satelite/producto/masasaire",
    "https://opendata.aemet.es/opendata/api/satelite/producto/h-r-v",
    "https://opendata.aemet.es/opendata/api/mapas-y-graficos/mapas-significativos/ambito/esp",
    "https://opendata.aemet.es/opendata/api/mapas-y-graficos/mapas-significativos/dia/a/ambito/esp"
)

foreach ($urlBase in $urls) {
    $url = "$urlBase`?api_key=$apiKey"
    try {
        $result = Invoke-RestMethod -Uri $url -Method Get
        Write-Host "SUCCESS: $urlBase"
        Write-Host "Response: $($result | Out-String)"
    }
    catch {
        Write-Host "FAILED: $urlBase"
        Write-Host "Error: $_"
    }
}
