const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

// 1. Gemini Content Generator Function
exports.generateGeminiContent = functions.https.onCall(async (data, context) => {
    // Ensure user is authenticated
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

    // Get API key from Firebase environment config
    // Set it via: firebase functions:config:set gemini.key="YOUR_KEY"
    const apiKey = functions.config().gemini?.key || process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new functions.https.HttpsError("internal", "API key de Gemini no configurada en el servidor.");
    }
    console.log(`Debug: Usando clave que empieza por ${apiKey.substring(0, 8)}... y termina en ...${apiKey.slice(-4)}`);

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gemini API Error: ${response.status} - ${errorText}`);
        }

        const json = await response.json();
        return json;
    } catch (error) {
        console.error("Gemini Function Error:", error);
        throw new functions.https.HttpsError("internal", error.message);
    }
});

// 2. Push Notifications Function
exports.sendPushNotification = functions.https.onCall(async (data, context) => {
    // Ensure user is authenticated
    if (!context.auth) {
        throw new functions.https.HttpsError(
            "unauthenticated",
            "El usuario debe estar autenticado para enviar notificaciones."
        );
    }

    const tokens = data.tokens;
    const title = data.titulo;
    const body = data.body;
    const dataPayload = data.dataPayload; // any additional remote data

    if (!tokens || tokens.length === 0) {
        throw new functions.https.HttpsError("invalid-argument", "No se proporcionaron tokens.");
    }

    const message = {
        notification: {
            title: title || "Nueva Notificación",
            body: body || ""
        },
        tokens: tokens,
    };

    if (dataPayload) {
        message.data = dataPayload;
    }

    try {
        const response = await admin.messaging().sendMulticast(message);
        console.log(`Successfully sent messages: ${response.successCount}, failed: ${response.failureCount}`);
        return { success: true, response: response };
    } catch (error) {
        console.error("Send Push Error:", error);
        throw new functions.https.HttpsError("internal", error.message);
    }
});
