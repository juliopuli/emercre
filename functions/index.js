const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

// 0. Oysta Vehicles Proxy (V.8.8.1 - Autenticado, URL oculta en servidor)
exports.getOystaVehicles = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            "unauthenticated",
            "El usuario debe estar autenticado para consultar vehículos."
        );
    }

    const userSnap = await admin.firestore().collection("users").doc(context.auth.uid).get();
    const userData = userSnap.exists ? userSnap.data() : {};

    // V.11.3.1: Permitir a todos los usuarios autenticados descargar los datos.
    // La visibilidad selectiva se gestionará en el front-end para permitir ver 
    // vehículos asignados a intervenciones sin ver necesariamente toda la flota.
    // if (userData.role !== 'super_admin' && userData.canSeeVehicles !== true) {
    //     throw new functions.https.HttpsError(
    //         "permission-denied",
    //         "No tienes permiso para consultar la posición de los vehículos."
    //     );
    // }

    let bridgeUrl = process.env.OYSTA_BRIDGE_URL;

    // V.11.5.2: Opción de conmutar entre dos cuentas de Bridge (Oysta GAS)
    // Buscamos la configuración en Firestore para ver qué cuenta usar
    try {
        const configSnap = await admin.firestore().collection("config").doc("oysta").get();
        if (configSnap.exists) {
            const config = configSnap.data();
            if (config.activeAccount === "account2" && config.url2) {
                bridgeUrl = config.url2;
                console.log("[Oysta] Using Account 2 bridge URL");
            } else if (config.activeAccount === "account1" && config.url1) {
                bridgeUrl = config.url1;
                console.log("[Oysta] Using Account 1 bridge URL");
            }
        }
    } catch (err) {
        console.warn("[Oysta] Error reading Firestore config, falling back to ENV:", err.message);
    }

    if (!bridgeUrl) {
        throw new functions.https.HttpsError("internal", "Oysta bridge URL no configurada.");
    }

    const userEmail = context.auth.token.email || context.auth.uid;

    try {
        const urlWithUser = `${bridgeUrl}${bridgeUrl.includes('?') ? '&' : '?'}u=${encodeURIComponent(userEmail)}`;
        const resp = await fetch(urlWithUser);
        if (!resp.ok) throw new Error("Oysta GAS responded with status " + resp.status);
        const result = await resp.json();

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

// 0.5. Renfe Real-Time Vehicles Proxy (V.9.1.0)
exports.getRenfeVehicles = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            "unauthenticated",
            "El usuario debe estar autenticado para consultar trenes."
        );
    }

    try {
        const resp = await fetch("https://gtfsrt.renfe.com/vehicle_positions.json", {
            headers: { "Accept": "application/json" }
        });
        if (!resp.ok) throw new Error("Renfe GTFS-RT responded with status " + resp.status);
        const result = await resp.json();
        return result;
    } catch (error) {
        console.error("Renfe Function Error:", error);
        throw new functions.https.HttpsError("internal", error.message);
    }
});

// 0.6. Renfe AVE/LD Real-Time Vehicles Proxy (V.9.2.0)
exports.getRenfeLargoRecorrido = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "El usuario debe estar autenticado.");
    }

    try {
        const resp = await fetch("https://tiempo-real.largorecorrido.renfe.com/renfe-visor/flotaLD.json", {
            headers: {
                "Accept": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
        });
        if (!resp.ok) throw new Error("Renfe LD responded with status " + resp.status);
        const result = await resp.json();
        return result;
    } catch (error) {
        console.error("Renfe LD Function Error:", error);
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
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${apiKey}`, {
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

// 3. Get Real API Usage (V.9.5.4 - Corrected metric query)
const monitoring = require("@google-cloud/monitoring");
const path = require("path");

exports.getRealApiUsage = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Debe estar autenticado.");
    }

    const userSnap = await admin.firestore().collection("users").doc(context.auth.uid).get();
    const role = userSnap.exists ? userSnap.data().role : null;

    if (role !== "super_admin") {
        throw new functions.https.HttpsError("permission-denied", "Solo el super_admin puede ver costos reales.");
    }

    const key = require("./usage-key.json");
    // Ambos proyectos monitorizados. emercre-488009 requiere que
    // emercre@appspot.gserviceaccount.com tenga rol "Monitoring Viewer" en ese proyecto.
    const targetProjectIds = ["emercre", "emercre-488009"];

    const monitoringClient = new monitoring.MetricServiceClient({ credentials: key });

    const now = Math.floor(Date.now() / 1000);
    const startOfMonth = Math.floor(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000);
    const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);

    // Correctly queries Cloud Monitoring with resource.type = "consumed_api"
    // serviceruntime metrics require this resource type in the filter
    const getMetric = async (serviceLabel, startTime) => {
        let grandTotal = 0;
        let errors = [];
        let debugInfo = [];

        for (const pid of targetProjectIds) {
            const request = {
                name: `projects/${pid}`,
                // CRITICAL FIX: must include resource.type = "consumed_api"
                filter: `metric.type = "serviceruntime.googleapis.com/api/request_count" AND resource.type = "consumed_api" AND resource.labels.service = "${serviceLabel}"`,
                interval: {
                    startTime: { seconds: startTime },
                    endTime: { seconds: now }
                },
                view: "FULL"
            };
            try {
                const [timeSeries] = await monitoringClient.listTimeSeries(request);
                let projectTotal = 0;
                timeSeries.forEach(ts => {
                    ts.points.forEach(p => {
                        // int64Value is returned as a string by the gRPC library
                        const val = Number(p.value.int64Value) || Number(p.value.doubleValue) || 0;
                        projectTotal += val;
                    });
                });
                grandTotal += projectTotal;
                debugInfo.push(`${pid}/${serviceLabel}: ${projectTotal} (${timeSeries.length} series)`);
            } catch (e) {
                const errMsg = `Error ${serviceLabel} en ${pid}: ${e.message}`;
                console.warn(errMsg);
                errors.push(errMsg);
                debugInfo.push(`${pid}/${serviceLabel}: ERROR - ${e.message}`);
            }
        }
        return { total: grandTotal, errors, debugInfo };
    };

    // Firestore metrics use a different resource type
    const getFirestoreMetric = async (metricType, startTime) => {
        let grandTotal = 0;
        let errors = [];
        for (const pid of targetProjectIds) {
            const request = {
                name: `projects/${pid}`,
                filter: `metric.type = "${metricType}"`,
                interval: {
                    startTime: { seconds: startTime },
                    endTime: { seconds: now }
                },
                view: "FULL"
            };
            try {
                const [timeSeries] = await monitoringClient.listTimeSeries(request);
                let total = 0;
                timeSeries.forEach(ts => {
                    ts.points.forEach(p => {
                        const val = Number(p.value.int64Value) || Number(p.value.doubleValue) || 0;
                        total += val;
                    });
                });
                grandTotal += total;
            } catch (e) {
                errors.push(`${pid}/${metricType}: ${e.message}`);
            }
        }
        return { total: grandTotal, errors };
    };

    // Consultamos datos reales
    const [
        mapsLoadRes, mapsPlacesRes, mapsRouteRes, mapsGeocodeRes,
        geminiDayRes, geminiMonthRes,
        fsReadsRes, fsWritesRes, fsDeletesRes
    ] = await Promise.all([
        getMetric("maps-backend.googleapis.com", startOfMonth),
        getMetric("places-backend.googleapis.com", startOfMonth),
        getMetric("directions-backend.googleapis.com", startOfMonth),
        getMetric("geocoding-backend.googleapis.com", startOfMonth),
        getMetric("generativelanguage.googleapis.com", startOfDay),
        getMetric("generativelanguage.googleapis.com", startOfMonth),
        getFirestoreMetric("firestore.googleapis.com/document/read_ops_count", startOfDay),
        getFirestoreMetric("firestore.googleapis.com/document/write_ops_count", startOfDay),
        getFirestoreMetric("firestore.googleapis.com/document/delete_ops_count", startOfDay)
    ]);

    const allErrors = [
        ...mapsLoadRes.errors, ...mapsPlacesRes.errors, ...mapsRouteRes.errors, ...mapsGeocodeRes.errors,
        ...geminiDayRes.errors, ...fsReadsRes.errors, ...fsWritesRes.errors, ...fsDeletesRes.errors
    ];

    const allDebugInfo = [
        ...(mapsLoadRes.debugInfo || []),
        ...(mapsPlacesRes.debugInfo || []),
        ...(mapsRouteRes.debugInfo || []),
        ...(mapsGeocodeRes.debugInfo || []),
        ...(geminiDayRes.debugInfo || [])
    ];

    console.log("[getRealApiUsage] Debug:", JSON.stringify(allDebugInfo));
    if (allErrors.length > 0) console.warn("[getRealApiUsage] Errors:", JSON.stringify(allErrors));

    return {
        maps: {
            load: mapsLoadRes.total,
            places: mapsPlacesRes.total,
            route: mapsRouteRes.total,
            geocode: mapsGeocodeRes.total
        },
        gemini: {
            day: geminiDayRes.total,
            month: geminiMonthRes.total,
            limit: 1500
        },
        firestore: {
            reads: fsReadsRes.total,
            writes: fsWritesRes.total,
            deletes: fsDeletesRes.total
        },
        syncErrors: allErrors,
        debug: allDebugInfo
    };
});

// 4. Purge Oysta Logs (V.9.6.4 - Robustecida con más memoria y timeout)
exports.purgeOystaLogs = functions.runWith({ timeoutSeconds: 540, memory: '1GB' }).https.onCall(async (data, context) => {
    // 1. Verify Authentication
    if (!context.auth) {
        throw new functions.https.HttpsError(
            "unauthenticated",
            "El usuario debe estar autenticado para purgar logs."
        );
    }

    // 2. Verify Authorization (Role must be super_admin)
    const userSnap = await admin.firestore().collection("users").doc(context.auth.uid).get();
    const userData = userSnap.exists ? userSnap.data() : {};

    if (userData.role !== "super_admin") {
        throw new functions.https.HttpsError(
            "permission-denied",
            "Solo el super_admin purgar los logs de Oysta."
        );
    }

    try {
        const db = admin.firestore();
        const logsRef = db.collection("oysta_logs");

        let deletedCount = 0;
        let hasMore = true;

        while (hasMore) {
            // Leemos solo los IDs para ahorrar memoria
            const snapshot = await logsRef.limit(500).get();

            if (snapshot.empty) {
                hasMore = false;
                break;
            }

            const batch = db.batch();
            snapshot.docs.forEach((doc) => {
                batch.delete(doc.ref);
            });

            await batch.commit();
            deletedCount += snapshot.size;

            // Pausa mínima para no saturar Firestore
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        console.log(`[purgeOystaLogs] Éxito: ${deletedCount} logs eliminados por ${context.auth.token.email}`);
        return { success: true, count: deletedCount, message: `Éxito: ${deletedCount} logs eliminados` };

    } catch (error) {
        console.error("[purgeOystaLogs] Error:", error);
        throw new functions.https.HttpsError("internal", "Error al purgar logs: " + error.message);
    }
});
