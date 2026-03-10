// Firebase Messaging Service Worker (V.9.6.5)
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// ── CACHE VERSIONING ──────────────────────────────────────────────────────────
// Cambia este valor cada vez que hagas una nueva versión para limpiar el caché
// antiguo y forzar que los clientes descarguen los archivos actualizados.
const CACHE_VERSION = 'emercre-v9.6.5';

firebase.initializeApp({
    // Inyectado por GitHub Actions durante el despliegue
    apiKey: "__FIREBASE_API_KEY__",
    authDomain: "emercre.firebaseapp.com",
    projectId: "emercre",
    storageBucket: "emercre.firebasestorage.app",
    messagingSenderId: "277256770434",
    appId: "1:277256770434:web:225aa9c7ff6b862d72b59b"
});

const messaging = firebase.messaging();

// Tomar el control inmediatamente sin esperar a que se cierren todas las ventanas
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

// Al activar: eliminar todos los cachés antiguos y tomar control de los clientes
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_VERSION)
                    .map((name) => {
                        console.log('[SW] Eliminando caché antiguo:', name);
                        return caches.delete(name);
                    })
            );
        }).then(() => clients.claim())
    );
});


// ── ESTRATEGIA DE CACHÉ: NETWORK-FIRST PARA HTML ─────────────────────────────
// Para las peticiones de navegación (el index.html), siempre intentamos primero
// la red para asegurarnos de cargar la versión más reciente desplegada en GitHub Pages.
// Solo si la red falla, usamos la caché como respaldo.
self.addEventListener('fetch', (event) => {
    // Solo interceptar peticiones de navegación (HTML)
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    // Respuesta de red exitosa: guardar en caché y devolver
                    const responseClone = response.clone();
                    caches.open(CACHE_VERSION).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                    return response;
                })
                .catch(() => {
                    // Sin red: usar caché si existe
                    return caches.match(event.request);
                })
        );
    }
    // El resto de peticiones (JS, CSS, APIs) las dejamos pasar sin modificar
});

// Manejador en segundo plano — DEBE mostrar la notificación explícitamente
// (en Android Chrome, si no llamamos showNotification, no aparece nada)
messaging.onBackgroundMessage((payload) => {
    console.log('[SW] Mensaje en segundo plano recibido:', payload);

    const notifTitle = payload.notification?.title
        || payload.data?.title
        || 'EmerCRE';

    const notifBody = payload.notification?.body
        || payload.data?.body
        || '';

    const notifOptions = {
        body: notifBody,
        icon: 'https://juliopuli.github.io/emercre/assets/logo_emercre.png',
        badge: 'https://juliopuli.github.io/emercre/assets/logo_emercre.png',
        tag: 'emercre-operacion',
        renotify: true,
        requireInteraction: true,
        data: payload.data || {}
    };

    self.registration.showNotification(notifTitle, notifOptions);
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
