const admin = require("firebase-admin");
const serviceAccount = require("./emercre-key.json");

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function checkLogs() {
    console.log("Checking last 5 oysta_logs...");
    const snap = await db.collection("oysta_logs").orderBy("fecha", "desc").limit(5).get();
    if (snap.empty) {
        console.log("No logs found.");
    } else {
        snap.forEach(doc => {
            const d = doc.data();
            console.log(`[${d.fecha?.toDate().toISOString()}] ${d.usuario}: ${d.detalle}`);
        });
    }
}

checkLogs().catch(console.error);
