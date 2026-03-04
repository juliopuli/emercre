[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$wc = New-Object System.Net.WebClient
$wc.Encoding = [System.Text.Encoding]::UTF8
$jsonStr = $wc.DownloadString("https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/spain-provinces.geojson")
$json = $jsonStr | ConvertFrom-Json
$andalusia = 'Málaga', 'Sevilla', 'Cádiz', 'Huelva', 'Córdoba', 'Jaén', 'Granada', 'Almería'

$result = @{}
foreach ($feature in $json.features) {
    if ($andalusia -contains $feature.properties.name) {
        $name = $feature.properties.name
        $coords = $feature.geometry.coordinates

        $allPoints = @()
        if ($feature.geometry.type -eq 'Polygon') {
            foreach ($ring in $coords) {
                foreach ($pts in $ring) { $allPoints += ,$pts }
            }
        } elseif ($feature.geometry.type -eq 'MultiPolygon') {
            foreach ($poly in $coords) {
                foreach ($ring in $poly) {
                    foreach ($pts in $ring) { $allPoints += ,$pts }
                }
            }
        }
        
        $minLng = ($allPoints | Measure-Object -Property [0] -Minimum).Minimum
        $maxLng = ($allPoints | Measure-Object -Property [0] -Maximum).Maximum
        $minLat = ($allPoints | Measure-Object -Property [1] -Minimum).Minimum
        $maxLat = ($allPoints | Measure-Object -Property [1] -Maximum).Maximum
        
        $width = $maxLng - $minLng
        $height = $maxLat - $minLat
        
        $svgPath = ""
        
        if ($feature.geometry.type -eq 'Polygon') {
            foreach ($ring in $coords) {
                for ($i = 0; $i -lt $ring.Count; $i++) {
                    $x = [math]::Round((($ring[$i][0] - $minLng) / $width) * 100, 2)
                    $y = [math]::Round((($maxLat - $ring[$i][1]) / $height) * 100, 2)
                    if ($i -eq 0) { $svgPath += "M$x,$y " }
                    else { $svgPath += "L$x,$y " }
                }
                $svgPath += "Z "
            }
        } elseif ($feature.geometry.type -eq 'MultiPolygon') {
            foreach ($poly in $coords) {
                foreach ($ring in $poly) {
                    for ($i = 0; $i -lt $ring.Count; $i++) {
                        $x = [math]::Round((($ring[$i][0] - $minLng) / $width) * 100, 2)
                        $y = [math]::Round((($maxLat - $ring[$i][1]) / $height) * 100, 2)
                        if ($i -eq 0) { $svgPath += "M$x,$y " }
                        else { $svgPath += "L$x,$y " }
                    }
                    $svgPath += "Z "
                }
            }
        }
        
        $result[$name] = @{
            bbox = @($minLng, $minLat, $maxLng, $maxLat)
            svg = $svgPath.Trim()
        }
    }
}
$result | ConvertTo-Json -Depth 5 | Out-File -FilePath andalusia_svgs.json -Encoding utf8
Write-Output "Done"
