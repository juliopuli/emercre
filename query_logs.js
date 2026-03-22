const admin = require('./functions/node_modules/firebase-admin');
const serviceAccount = require('/home/julio/Descargas/emercre-82f919940f08.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
async function run() {
  const snap = await db.collection('oysta_logs').orderBy('fecha', 'desc').limit(20).get();
  console.log('Total found:', snap.size);
  snap.forEach(doc => {
    const data = doc.data();
    console.log(data.fecha ? data.fecha.toDate() : 'No date', '|', data.usuario, '|', data.detalle);
  });
}
run();
