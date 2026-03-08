const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

// 0. Oysta Vehicles Proxy (V.6.2.0 - Autenticado, URL oculta en servidor)
exports.getOystaVehicles = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            "unauthenticated",
            "El usuario debe estar autenticado para consultar vehículos."
        );
    }

    const bridgeUrl = process.env.OYSTA_BRIDGE_URL;
    if (!bridgeUrl) {
        throw new functions.https.HttpsError("internal", "Oysta bridge URL no configurada en el servidor.");
    }

    const userEmail = context.auth.token.email || context.auth.uid;

    try {
        // Pasamos el email del usuario que solicita para trazabilidad si el puente hace login
        const urlWithUser = `${bridgeUrl}${bridgeUrl.includes('?') ? '&' : '?'}u=${encodeURIComponent(userEmail)}`;
        const resp = await fetch(urlWithUser);
        if (!resp.ok) throw new Error("Oysta GAS responded with status " + resp.status);
        const result = await resp.json();

        // Si el puente indica que ha realizado un login real (inserción de credenciales)
        if (result.loginPerformed) {
            await admin.firestore().collection("oysta_logs").add({
                fecha: admin.firestore.FieldValue.serverTimestamp(),
                usuario: userEmail,
                tipo: "Oysta",
                info: result.loginInfo || "Login automático por expiración de sesión"
            });
        }

        return result;
    } catch (error) {
        console.error("Oysta Function Error:", error);
        throw new functions.https.HttpsError("internal", error.message);
    }
});

// 1. Gemini Content Generator Function (V.6.2.0)
exports.generateGeminiContent = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            "unauthenticated",
            "El usuario debe estar autenticado para usar Gemini."
        );
    }

    const payload = data.payload;
    if (!payload) {
        throw new functions.https.HttpsError("invalid-argument", "Falta el payload (prompt).");
    }

    const apiKey = functions.config().gemini?.key || process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new functions.https.HttpsError("internal", "API key de Gemini no configurada en el servidor.");
    }

    // Send only the contents — generationConfig caused 400 errors with Gemini v1
    const formattedPayload = {
        contents: payload.contents
    };

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(formattedPayload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gemini API Error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();

        // V.8.6.0: Log usage
        try {
            const now = new Date();
            const dayId = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
            await admin.firestore().collection("api_usage").doc(dayId).set({
                ia_report: admin.firestore.FieldValue.increment(1)
            }, { merge: true });
        } catch (e) { console.warn("Error logging Gemini usage:", e); }

        return result;
    } catch (error) {
        console.error("Gemini Function Error:", error);
        throw new functions.https.HttpsError("internal", error.message);
    }
});

// 2. Push Notifications Function (V.6.2.0 - Fixed mobile delivery)
exports.sendPushNotification = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            "unauthenticated",
            "El usuario debe estar autenticado para enviar notificaciones."
        );
    }

    const tokens = data.tokens;
    const title = data.titulo || "EmerCRE";
    const body = data.body || "";
    const dataPayload = data.dataPayload || {};

    if (!tokens || tokens.length === 0) {
        throw new functions.https.HttpsError("invalid-argument", "No se proporcionaron tokens.");
    }

    // FCM data payload values MUST all be strings
    const stringData = {};
    Object.keys(dataPayload).forEach(k => {
        stringData[k] = String(dataPayload[k]);
    });

    const LOGO_URL = "https://juliopuli.github.io/emercre/assets/logo_emercre.png";

    // Build each message individually to use send() instead of sendMulticast()
    // sendMulticast() ignores platform-specific configs in older admin SDKs
    const results = await Promise.allSettled(
        tokens.map(token =>
            admin.messaging().send({
                token: token,
                // Sin campo 'notification' — mensaje solo de datos para evitar doble notificación.
                // El SW (onBackgroundMessage) es el único que llama showNotification().
                data: {
                    ...stringData,
                    title: title,
                    body: body
                },
                // Android: high priority para entrega inmediata
                android: {
                    priority: "high"
                },
                // WebPush: solo urgencia + link (sin notification para evitar duplicados)
                webpush: {
                    headers: { Urgency: "high" },
                    fcm_options: {
                        link: stringData.chatFrom
                            ? `https://juliopuli.github.io/emercre/?chat=${stringData.chatFrom}`
                            : "https://juliopuli.github.io/emercre/"
                    }
                },
                // APNS: para iOS Safari PWA
                apns: {
                    headers: { "apns-priority": "10" },
                    payload: {
                        aps: {
                            alert: { title: title, body: body },
                            sound: "default",
                            badge: 1
                        }
                    }
                }
            })
        )
    );

    const successCount = results.filter(r => r.status === "fulfilled").length;
    const failureCount = results.filter(r => r.status === "rejected").length;
    results
        .filter(r => r.status === "rejected")
        .forEach(r => console.error("FCM send error:", r.reason));

    console.log(`Push: ${successCount} OK, ${failureCount} failed out of ${tokens.length}`);
    return { success: true, successCount, failureCount };
});

// 3. Get Real API Usage (V.8.6.1 - Using Service Account)
const monitoring = require("@google-cloud/monitoring");
const path = require("path");
const client = new monitoring.MetricServiceClient({
    keyFilename: path.join(__dirname, "usage-key.json")
});

exports.getRealApiUsage = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Debe estar autenticado.");
    }

    const userSnap = await admin.firestore().collection("users").doc(context.auth.uid).get();
    const role = userSnap.exists ? userSnap.data().role : null;

    if (role !== "super_admin") {
        throw new functions.https.HttpsError("permission-denied", "Solo el super_admin puede ver costos reales.");
    }

    const projectId = "emercre-488009"; // ID del JSON proporcionado
    const now = Math.floor(Date.now() / 1000);
    const startOfMonth = Math.floor(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000);
    const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);

    const getMetric = async (metricType, filter = "", startTime) => {
        const request = {
            name: client.projectPath(projectId),
            filter: `metric.type = "${metricType}" ${filter}`,
            interval: {
                startTime: { seconds: startTime },
                endTime: { seconds: now }
            },
            view: "FULL"
        };
        try {
            const [timeSeries] = await client.listTimeSeries(request);
            let total = 0;
            timeSeries.forEach(s => {
                s.points.forEach(p => {
                    const val = p.value.int64Value || p.value.doubleValue || 0;
                    total += Number(val);
                });
            });
            return total;
        } catch (e) {
            console.error(`Error fetching metric ${metricType}:`, e);
            return 0;
        }
    };

    // Consultamos datos reales
    const [mapsLoad, mapsPlaces, mapsRoute, mapsGeocode, geminiDay, geminiMonth, fsReads, fsWrites] = await Promise.all([
        getMetric("serviceruntime.googleapis.com/api/request_count", 'AND resource.labels.service = "maps-backend.googleapis.com"', startOfMonth),
        getMetric("serviceruntime.googleapis.com/api/request_count", 'AND resource.labels.service = "places-backend.googleapis.com"', startOfMonth),
        getMetric("serviceruntime.googleapis.com/api/request_count", 'AND resource.labels.service = "directions-backend.googleapis.com"', startOfMonth),
        getMetric("serviceruntime.googleapis.com/api/request_count", 'AND resource.labels.service = "geocoding-backend.googleapis.com"', startOfMonth),
        getMetric("serviceruntime.googleapis.com/api/request_count", 'AND resource.labels.service = "generativelanguage.googleapis.com"', startOfDay),
        getMetric("serviceruntime.googleapis.com/api/request_count", 'AND resource.labels.service = "generativelanguage.googleapis.com"', startOfMonth),
        getMetric("firestore.googleapis.com/document/read_ops_count", "", startOfDay),
        getMetric("firestore.googleapis.com/document/write_ops_count", "", startOfDay)
    ]);

    return {
        maps: { load: mapsLoad, places: mapsPlaces, route: mapsRoute, geocode: mapsGeocode },
        gemini: { day: geminiDay, month: geminiMonth, limit: 1500 },
        firestore: { reads: fsReads, writes: fsWrites }
    };
});
