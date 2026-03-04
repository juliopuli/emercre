// Firebase Messaging Service Worker (V.6.1.3)
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyAHtrxaBazArqa8znWsUIVYxTsS7zoOOmc",
    authDomain: "emercre.firebaseapp.com",
    projectId: "emercre",
    storageBucket: "emercre.firebasestorage.app",
    messagingSenderId: "277256770434",
    appId: "1:277256770434:web:225aa9c7ff6b862d72b59b"
});

const messaging = firebase.messaging();

// Tomar el control inmediatamente sin esperar a que se cierren todas las ventanas
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(clients.claim()));


// Manejador en segundo plano
messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Mensaje en segundo plano recibido:', payload);
});

// Manejador de clics (V.6.0.7)
// Estrategia dual:
//   - App abierta  → postMessage al cliente para navegar al chat sin recargar
//   - App cerrada  → abre la URL con ?chat=UID (gestionado por fcm_options.link del GAS)
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    // Extraer chatFrom del payload FCM
    let chatFrom = null;
    const notifData = event.notification.data;
    if (notifData) {
        if (notifData.FCM_MSG && notifData.FCM_MSG.data && notifData.FCM_MSG.data.chatFrom) {
            chatFrom = notifData.FCM_MSG.data.chatFrom;
        } else if (notifData.chatFrom) {
            chatFrom = notifData.chatFrom;
        }
    }

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            if (clientList.length > 0) {
                // App ya está abierta: mandar mensaje para navegar sin recargar página
                const client = clientList[0];
                if (chatFrom) {
                    client.postMessage({ type: 'OPEN_CHAT', chatFrom: chatFrom });
                }
                return client.focus();
            }
            // App cerrada: abrir con parámetro en la URL
            const url = chatFrom
                ? 'https://juliopuli.github.io/emercre/?chat=' + chatFrom
                : 'https://juliopuli.github.io/emercre/';
            return clients.openWindow(url);
        })
    );
});
