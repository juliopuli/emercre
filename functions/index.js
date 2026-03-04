const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

// 0. Oysta Vehicles Proxy (V.6.1.5 - Autenticado, URL oculta en servidor)
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

    try {
        const resp = await fetch(bridgeUrl);
        if (!resp.ok) throw new Error("Oysta GAS responded with status " + resp.status);
        const data = await resp.json();
        return data;
    } catch (error) {
        console.error("Oysta Function Error:", error);
        throw new functions.https.HttpsError("internal", error.message);
    }
});

// 1. Gemini Content Generator Function (V.6.1.3)
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

        return await response.json();
    } catch (error) {
        console.error("Gemini Function Error:", error);
        throw new functions.https.HttpsError("internal", error.message);
    }
});

// 2. Push Notifications Function (V.6.1.3 - Fixed mobile delivery)
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
