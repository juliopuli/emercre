// Firebase Messaging Service Worker (V.5.7.0)
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

// Manejador en segundo plano (V.5.10.1)
// NOTA: NO llamar showNotification aquí. FCM ya muestra la notificación
// automáticamente a partir de webpush.notification en el payload.
// Si lo llamamos, se duplica.
messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Mensaje en segundo plano recibido:', payload);
});

// Manejador de clics (V.5.8.7)
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            if (clientList.length > 0) {
                let client = clientList[0];
                for (let i = 0; i < clientList.length; i++) {
                    if (clientList[i].focused) { client = clientList[i]; break; }
                }
                return client.focus();
            }
            return clients.openWindow('index.html');
        })
    );
});
