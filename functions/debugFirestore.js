const admin = require('firebase-admin');
admin.initializeApp({
  projectId: 'emercre'
});

async function run() {
    const db = admin.firestore();
    const statesSnap = await db.collection("oysta_vehicle_states").get();
    
    console.log(`Found ${statesSnap.docs.length} active tracking documents.`);
    for (const doc of statesSnap.docs) {
        console.log(`--- Intervention: ${doc.id} ---`);
        const data = doc.data();
        console.log(JSON.stringify(data, null, 2));
    }
}
run().then(() => process.exit(0)).catch(console.error);
