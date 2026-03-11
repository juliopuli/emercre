const admin = require('./functions/node_modules/firebase-admin');
const serviceAccount = require('/home/julio/Descargas/emercre-82f919940f08.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
async function run() {
  const snap = await db.collection('vehiculos').get();
  snap.forEach(doc => {
    const data = doc.data();
    if(JSON.stringify(data).includes('7417')) {
        console.log('ID Firestore:', doc.id);
        console.log('Oysta ID:', data.oystaId);
        console.log('Indicativo:', data.indicativo);
        console.log('Matricula:', data.matricula);
        console.log('---');
    }
  });
}
run();
