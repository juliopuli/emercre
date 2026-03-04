<?php
$data = file_get_contents('https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/spain-provinces.geojson');
$json = json_decode($data, true);
$andalusia = ['Málaga', 'Sevilla', 'Cádiz', 'Huelva', 'Córdoba', 'Jaén', 'Granada', 'Almería'];
$result = [];
foreach ($json['features'] as $f) {
    if (in_array($f['properties']['name'], $andalusia)) {
        $name = $f['properties']['name'];
        $coords = $f['geometry']['coordinates'];
        $type = $f['geometry']['type'];
        
        $allPoints = [];
        if ($type == 'Polygon') {
            foreach ($coords as $ring) {
                foreach ($ring as $pt) $allPoints[] = $pt;
            }
        } else if ($type == 'MultiPolygon') {
            foreach ($coords as $poly) {
                foreach ($poly as $ring) {
                    foreach ($ring as $pt) $allPoints[] = $pt;
                }
            }
        }
        
        $lngs = array_column($allPoints, 0);
        $lats = array_column($allPoints, 1);
        $minLng = min($lngs); $maxLng = max($lngs);
        $minLat = min($lats); $maxLat = max($lats);
        
        $width = $maxLng - $minLng;
        $height = $maxLat - $minLat;
        if($width == 0) $width = 0.0001;
        if($height == 0) $height = 0.0001;
        
        $svgPath = "";
        
        $processRing = function($ring) use (&$svgPath, $minLng, $maxLat, $width, $height) {
            foreach ($ring as $i => $pt) {
                $x = round((($pt[0] - $minLng) / $width) * 100, 2);
                $y = round((($maxLat - $pt[1]) / $height) * 100, 2);
                if ($i == 0) $svgPath .= "M$x,$y ";
                else $svgPath .= "L$x,$y ";
            }
            $svgPath .= "Z ";
        };
        
        if ($type == 'Polygon') {
            foreach ($coords as $ring) $processRing($ring);
        } else if ($type == 'MultiPolygon') {
            foreach ($coords as $poly) {
                foreach ($poly as $ring) $processRing($ring);
            }
        }
        
        $result[$name] = [
            'bbox' => [$minLng, $minLat, $maxLng, $maxLat],
            'svg' => trim($svgPath)
        ];
    }
}
file_put_contents('andalusia_svgs.json', json_encode($result, JSON_PRETTY_PRINT));
echo "DONE\n";
?>
