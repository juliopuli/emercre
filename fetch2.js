var http = new ActiveXObject("MSXML2.XMLHTTP");
http.open("GET", "https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/spain-provinces.geojson", false);
http.send();
var jsonText = http.responseText;

var json = eval("(" + jsonText + ")");

// Match using safe substrings
var andalusia = ['M', 'S', 'C', 'H', 'J', 'G', 'A']; // wait, better match the exact string without bad chars.
var result = {};
for (var i = 0; i < json.features.length; i++) {
    var f = json.features[i];
    var name = f.properties.name;
    
    var n = name.toLowerCase();
    var isAnda = (n.indexOf('laga')>-1) || (n.indexOf('sevilla')>-1) || (n.indexOf('diz')>-1) || (n.indexOf('huelva')>-1) || (n.indexOf('rdoba')>-1) || (n.indexOf('n')>-1 && n.indexOf('ja')>-1) || (n.indexOf('ranada')>-1) || (n.indexOf('almer')>-1);
    
    if (isAnda) {
        // Fix the key name
        if (n.indexOf('laga')>-1) name = 'Málaga';
        if (n.indexOf('sevilla')>-1) name = 'Sevilla';
        if (n.indexOf('diz')>-1) name = 'Cádiz';
        if (n.indexOf('huelva')>-1) name = 'Huelva';
        if (n.indexOf('rdoba')>-1) name = 'Córdoba';
        if (n.indexOf('n')>-1 && n.indexOf('ja')>-1) name = 'Jaén';
        if (n.indexOf('ranada')>-1) name = 'Granada';
        if (n.indexOf('almer')>-1) name = 'Almería';

        var coords = f.geometry.coordinates;
        var type = f.geometry.type;
        
        var minLng = 999, maxLng = -999, minLat = 999, maxLat = -999;
        function p(pt) {
            if (pt[0] < minLng) minLng = pt[0];
            if (pt[0] > maxLng) maxLng = pt[0];
            if (pt[1] < minLat) minLat = pt[1];
            if (pt[1] > maxLat) maxLat = pt[1];
        }
        if (type == 'Polygon') {
            for(var r=0; r<coords.length; r++) for(var c=0; c<coords[r].length; c++) p(coords[r][c]);
        } else if (type == 'MultiPolygon') {
            for(var pl=0; pl<coords.length; pl++) for(var r=0; r<coords[pl].length; r++) for(var c=0; c<coords[pl][r].length; c++) p(coords[pl][r][c]);
        }
        
        var width = maxLng - minLng;
        var height = maxLat - minLat;
        if(width===0) width=0.0001; if(height===0) height=0.0001;
        
        var svg = "";
        function ring(r) {
            for (var k = 0; k < r.length; k++) {
                var x = Math.round(((r[k][0] - minLng) / width) * 1000) / 10;
                var y = Math.round(((maxLat - r[k][1]) / height) * 1000) / 10;
                if (k === 0) svg += "M"+x+","+y+" ";
                else svg += "L"+x+","+y+" ";
            }
            svg += "Z ";
        }
        if (type == 'Polygon') for(var r=0; r<coords.length; r++) ring(coords[r]);
        else if (type == 'MultiPolygon') for(var pl=0; pl<coords.length; pl++) for(var r=0; r<coords[pl].length; r++) ring(coords[pl][r]);
        
        result[name] = { bbox: [minLng, minLat, maxLng, maxLat], svg: svg.replace(/^\s+|\s+$/g,'') };
    }
}
var fso = new ActiveXObject("Scripting.FileSystemObject");
var file = fso.CreateTextFile("andalusia_svgs.json", true, true);
function str(o) {
    if (typeof o === 'string') return '"'+o+'"';
    if (typeof o === 'number') return o;
    if (o instanceof Array) { var a=[]; for(var i=0;i<o.length;i++) a.push(str(o[i])); return "["+a.join(",")+"]"; }
    var b=[]; for(var k in o) b.push('"'+k+'":'+str(o[k])); return "{"+b.join(",")+"}";
}
file.Write(str(result));
file.Close();
