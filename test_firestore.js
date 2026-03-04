const https = require('https');

https.get('https://firestore.googleapis.com/v1/projects/emercre/databases/(default)/documents/eries?pageSize=5', (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        console.log(JSON.parse(data));
    });
}).on("error", (err) => {
    console.log("Error: " + err.message);
});
