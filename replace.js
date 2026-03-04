var fso = new ActiveXObject("Scripting.FileSystemObject");
var f1 = fso.OpenTextFile("andalusia_svgs_utf8.json", 1, false, -1);
var jsonText = f1.ReadAll(); f1.Close();
var data = eval("(" + jsonText + ")");

var f2 = fso.OpenTextFile("index.html", 1, false, -1);
var html = f2.ReadAll(); f2.Close();

var bboxStr = "const PROV_BBOX = {\n";
var svgStr = "const SVGS = {\n";
for (var k in data) {
    if (Object.prototype.hasOwnProperty.call(data, k)) {
        bboxStr += "            '" + k + "': [" + data[k].bbox.join(", ") + "],\n";
        svgStr += "            '" + k + "': '<svg viewBox=\"0 0 100 100\" style=\"width:100%; height:100%; padding:20px; overflow:visible;\"><path d=\"" + data[k].svg + "\" fill=\"#ebdfd0\" stroke=\"#0b2241\" stroke-width=\"0.5\"/></svg>',\n";
    }
}
bboxStr = bboxStr.slice(0, -2) + "\n          };";
svgStr += "            'default': '<svg viewBox=\"0 0 100 100\" style=\"width:100%; height:100%; padding:5px; overflow:visible;\"><path d=\"M20,50 Q20,20 50,20 Q80,20 80,50 Q80,80 50,80 Q20,80 20,50 Z\" fill=\"#ebdfd0\" stroke=\"#0b2241\" stroke-width=\"0.5\"/></svg>'\n          };";

html = html.replace(/const PROV_BBOX = \{[\s\S]*?\};\s*\/\/ Mapas SVG estáticos simplificados para siluetas de las provincias\s*const SVGS = \{[\s\S]*?\};/, bboxStr + "\n\n          // Mapas SVG reales de las provincias\n          " + svgStr);

html = html.replace(/V\.5\.11\.\d+/g, "V.5.12.0");

var f3 = fso.CreateTextFile("index.html", true, true);
f3.Write(html); f3.Close();
WScript.Echo("Success HTML Update");
