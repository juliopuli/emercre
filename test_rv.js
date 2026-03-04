const https = require('https');

async function testRV() {
    const get = (url) => new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', d => data += d);
            res.on('end', () => resolve({ statusCode: res.statusCode, data }));
        }).on('error', reject);
    });

    const mapsRes = await get('https://api.rainviewer.com/public/weather-maps.json');
    const path = JSON.parse(mapsRes.data).radar.past.slice(-1)[0].path;
    console.log("Path:", path);

    // Spain center approx
    // z=6, x=31, y=24
    const res1 = await get(`https://tilecache.rainviewer.com${path}/256/6/31/24/2/1_1.png`);
    console.log("Zoom 6:", res1.statusCode);

    // Sevilla approx zoom 12
    const z = 12;
    const lat = 37.3891;
    const lng = -5.9845;
    const x = Math.floor((lng + 180) / 360 * Math.pow(2, z));
    const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z));

    console.log("Zoom 12 coords:", x, y);
    const res2 = await get(`https://tilecache.rainviewer.com${path}/256/${z}/${x}/${y}/2/1_1.png`);
    console.log("Zoom 12:", res2.statusCode);

    const z2 = 15;
    const x2 = Math.floor((lng + 180) / 360 * Math.pow(2, z2));
    const y2 = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z2));
    const res3 = await get(`https://tilecache.rainviewer.com${path}/256/${z2}/${x2}/${y2}/2/1_1.png`);
    console.log("Zoom 15:", res3.statusCode);
}

testRV();
