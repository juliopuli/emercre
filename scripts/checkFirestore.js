const admin = require('firebase-admin');

async function main() {
    try {
        if (!admin.apps.length) {
            // Need a service account or emulator. 
            // If running on a cloud function environment, it works. 
            // On local dev, I don't have the credential file.
            console.log("Cannot securely access Firestore directly from simple script without GOOGLE_APPLICATION_CREDENTIALS.");
        }
    } catch (e) {
        console.error(e);
    }
}
main();
