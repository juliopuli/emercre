// Firebase Messaging Service Worker (V.5.7.0)
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "__FIREBASE_API_KEY__",
    authDomain: "emercre.firebaseapp.com",
    projectId: "emercre",
    storageBucket: "emercre.firebasestorage.app",
    messagingSenderId: "277256770434",
    appId: "1:277256770434:web:225aa9c7ff6b862d72b59b"
});

const messaging = firebase.messaging();

// Manejador en segundo plano
messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Mensaje en segundo plano recibido:', payload);

    const notificationTitle = payload.notification.title;
    const notificationOptions = {
        body: payload.notification.body,
        icon: '/assets/logo_emercre.png',
        data: payload.data
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});
