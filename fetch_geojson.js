var http = new ActiveXObject("MSXML2.XMLHTTP");
http.open("GET", "https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/spain-provinces.geojson", false);
http.send();
var jsonText = http.responseText;

var json = eval("(" + jsonText + ")");
var andalusia = ['Málaga', 'Sevilla', 'Cádiz', 'Huelva', 'Córdoba', 'Jaén', 'Granada', 'Almería'];

var result = {};
for (var i = 0; i < json.features.length; i++) {
    var f = json.features[i];
    var name = f.properties.name;

    var isAndalusia = false;
    for (var j = 0; j < andalusia.length; j++) {
        if (andalusia[j] === name) {
            isAndalusia = true;
            break;
        }
    }

    if (isAndalusia) {
        var coords = f.geometry.coordinates;
        var type = f.geometry.type;

        var minLng = 999, maxLng = -999, minLat = 999, maxLat = -999;

        function processPt(pt) {
            if (pt[0] < minLng) minLng = pt[0];
            if (pt[0] > maxLng) maxLng = pt[0];
            if (pt[1] < minLat) minLat = pt[1];
            if (pt[1] > maxLat) maxLat = pt[1];
        }

        if (type == 'Polygon') {
            for (var r = 0; r < coords.length; r++) {
                for (var p = 0; p < coords[r].length; p++) processPt(coords[r][p]);
            }
        } else if (type == 'MultiPolygon') {
            for (var pl = 0; pl < coords.length; pl++) {
                for (var r = 0; r < coords[pl].length; r++) {
                    for (var p = 0; p < coords[pl][r].length; p++) processPt(coords[pl][r][p]);
                }
            }
        }

        var width = maxLng - minLng;
        var height = maxLat - minLat;
        if (width === 0) width = 0.0001;
        if (height === 0) height = 0.0001;

        var svgPath = "";
        function processRing(ring) {
            for (var k = 0; k < ring.length; k++) {
                var pt = ring[k];
                var x = Math.round(((pt[0] - minLng) / width) * 1000) / 10;
                var y = Math.round(((maxLat - pt[1]) / height) * 1000) / 10;
                if (k === 0) svgPath += "M" + x + "," + y + " ";
                else svgPath += "L" + x + "," + y + " ";
            }
            svgPath += "Z ";
        }

        if (type == 'Polygon') {
            for (var r = 0; r < coords.length; r++) processRing(coords[r]);
        } else if (type == 'MultiPolygon') {
            for (var pl = 0; pl < coords.length; pl++) {
                for (var r = 0; r < coords[pl].length; r++) processRing(coords[pl][r]);
            }
        }

        result[name] = {
            bbox: [minLng, minLat, maxLng, maxLat],
            svg: svgPath.replace(/\s+$/, '')
        };
    }
}

var fso = new ActiveXObject("Scripting.FileSystemObject");
var file = fso.CreateTextFile("andalusia_svgs.json", true, true); // true for unicode

function str(obj) {
    if (typeof obj === 'string') return '"' + obj + '"';
    if (typeof obj === 'number') return obj;
    if (obj instanceof Array) {
        var a = [];
        for (var i = 0; i < obj.length; i++) a.push(str(obj[i]));
        return "[" + a.join(",") + "]";
    }
    var b = [];
    for (var k in obj) b.push('"' + k + '":' + str(obj[k]));
    return "{" + b.join(",") + "}";
}

file.Write(str(result));
file.Close();
WScript.Echo("Done JS!");
