const admin = require('./functions/node_modules/firebase-admin');
const serviceAccount = require('/home/julio/Descargas/emercre-82f919940f08.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
async function run() {
  const snap = await db.collection('oysta_logs').orderBy('fecha', 'desc').limit(5).get();
  snap.forEach(doc => {
    console.log(doc.data());
  });
}
run();
