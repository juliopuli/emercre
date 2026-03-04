const https = require('https');

async function testRV() {
    const get = (url) => new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', d => data += d);
            res.on('end', () => resolve({ statusCode: res.statusCode, data }));
        }).on('error', reject);
    });

    try {
        const mapsRes = await get('https://api.rainviewer.com/public/weather-maps.json');
        const path = JSON.parse(mapsRes.data).radar.past.slice(-1)[0].path;
        console.log("Path:", path);

        // Let's test zooms 6 to 15 at center of Spain
        const lat = 40.4168;
        const lng = -3.7038;

        for (let z = 6; z <= 15; z++) {
            const x = Math.floor((lng + 180) / 360 * Math.pow(2, z));
            const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z));

            const res = await get(`https://tilecache.rainviewer.com${path}/256/${z}/${x}/${y}/2/1_1.png`);
            console.log(`Zoom ${z}:`, res.statusCode);
            // add a small delay
            await new Promise(r => setTimeout(r, 200));
        }
    } catch (e) {
        console.error(e);
    }
}

testRV();
