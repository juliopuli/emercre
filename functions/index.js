const functions = require("firebase-functions");
const admin = require("firebase-admin");
const https = require("https");

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
                detalle: result.loginInfo || "Login automático por expiración de sesión"
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

// 0.7. AIS Salvamento Marítimo Proxy (V.13.5.1)
const WebSocket = require("ws");
exports.getAISVehicles = functions.runWith({ timeoutSeconds: 30, memory: '256MB' }).https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Debe estar autenticado.");
    }

    return new Promise((resolve, reject) => {
        const socket = new WebSocket("wss://stream.aisstream.io/v0/stream");
        const ships = {};
        const startTime = Date.now();
        const duration = 14000; // Aumentado a 14 segundos para maximizar captura sin exceder timeout GCF
        let timeout = null;

        const finish = () => {
            if (timeout) clearTimeout(timeout);
            if (socket.readyState === WebSocket.OPEN) socket.close();
            const result = Object.values(ships);
            console.log(`[AIS Proxy] Finalizado. Capturados ${result.length} buques.`);
            resolve(result);
        };

        socket.on('open', () => {
            const subscription = {
                APIKey: "3c918bc8196c217b9a40cbc618a39f8cd618b787",
                BoundingBoxes: [[[-90, -180], [90, 180]]], // Cobertura Global (Mundo entero)
            };
            socket.send(JSON.stringify(subscription));
            timeout = setTimeout(finish, duration);
        });

        socket.on('message', (event) => {
            try {
                const msg = JSON.parse(event.toString());
                if (!msg.MetaData || !msg.MetaData.MMSI) return;

                const mmsi = msg.MetaData.MMSI;
                const rawName = (msg.MetaData.ShipName || "").trim();
                const lat = msg.MetaData.latitude;
                const lng = msg.MetaData.longitude;
                let sog = 0;

                // Capturar velocidad (SOG) según el tipo de mensaje
                if (msg.Message && msg.Message.PositionReport) {
                    sog = msg.Message.PositionReport.Sog;
                } else if (msg.Message && msg.Message.StandardClassBPositionReport) {
                    sog = msg.Message.StandardClassBPositionReport.Sog;
                }

                // Capturar tipo si viene en el mensaje estático
                let shipType = 0;
                if (msg.MessageType === "ShipStaticData" && msg.Message && msg.Message.ShipStaticData) {
                    shipType = msg.Message.ShipStaticData.ShipType;
                }

                // Check robusto de coordenadas (pueden ser 0)
                if (typeof lat === 'number' && typeof lng === 'number') {
                    if (!ships[mmsi]) {
                        ships[mmsi] = {
                            mmsi: mmsi,
                            name: rawName || "Buque " + mmsi,
                            lat: lat,
                            lng: lng,
                            speed: sog || 0,
                            type: shipType || 0,
                            lastUpdate: Date.now()
                        };
                    } else {
                        ships[mmsi].lat = lat;
                        ships[mmsi].lng = lng;
                        if (sog !== undefined) ships[mmsi].speed = sog;
                        if (rawName && (!ships[mmsi].name || ships[mmsi].name.startsWith("Buque "))) {
                            ships[mmsi].name = rawName;
                        }
                        if (shipType) ships[mmsi].type = shipType;
                        ships[mmsi].lastUpdate = Date.now();
                    }
                }
            } catch (e) {
                // Ignore
            }
        });

        socket.on('error', (err) => {
            console.error("[AIS Proxy] Socket error:", err);
            finish();
        });

        socket.on('close', () => {
            finish();
        });
    });
});

// 0.8. Semana Santa Málaga Proxy (V.14.2.0)
exports.getSemanaSantaData = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Debe estar autenticado.");
    }

    const dayId = data.dayId || 1;
    const apiKey = process.env.PENITENTE_API_KEY;
    
    if (!apiKey) {
        throw new functions.https.HttpsError("internal", "API Key de 'El Penitente' no configurada en el servidor.");
    }

    try {
        const resp = await fetch(`https://api.elpenitente.app/api/v1/geolocalizaciones/${dayId}`, {
            headers: {
                "Accept": "application/json",
                "Authorization": `Bearer ${apiKey}`
            }
        });
        if (!resp.ok) throw new Error("Penitente API error: " + resp.status);
        const result = await resp.json();
        return result;
    } catch (error) {
        console.error("Semana Santa Function Error:", error);
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
    const userData = userSnap.exists ? userSnap.data() : {};
    const role = userData.role || null;

    if (role !== "super_admin") {
        throw new functions.https.HttpsError("permission-denied", "Solo el super_admin puede ver costos reales.");
    }

    const key = require("./usage-key.json");
    // Triple Proyecto: Account 1 (emercre + emercre-488009) y Account 2 (emercre-mapsec)
    const targetProjectIds = ["emercre", "emercre-488009", "emercre-mapsec"];

    const monitoringClient = new monitoring.MetricServiceClient({ credentials: key });

    const now = Math.floor(Date.now() / 1000);
    const startOfMonth = Math.floor(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000);
    const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);

    // Correctly queries Cloud Monitoring with resource.type = "consumed_api"
    const getMetric = async (serviceLabel, startTime) => {
        let results = {}; // pid -> total
        let errors = [];

        for (const pid of targetProjectIds) {
            const request = {
                name: `projects/${pid}`,
                filter: `metric.type = "serviceruntime.googleapis.com/api/request_count" AND resource.type = "consumed_api" AND resource.labels.service = "${serviceLabel}" AND resource.labels.project_id = "${pid}"`,
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
                        const val = Number(p.value.int64Value) || Number(p.value.doubleValue) || 0;
                        projectTotal += val;
                    });
                });
                results[pid] = projectTotal;
            } catch (e) {
                const errMsg = `Error ${serviceLabel} en ${pid}: ${e.message}`;
                console.warn(errMsg);
                errors.push(errMsg);
            }
        }
        return { results, errors };
    };

    // Firestore metrics use a different resource type
    const getFirestoreMetric = async (metricType, startTime) => {
        let results = {};
        let errors = [];
        for (const pid of targetProjectIds) {
            const request = {
                name: `projects/${pid}`,
                filter: `metric.type = "${metricType}" AND resource.labels.project_id = "${pid}"`,
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
                results[pid] = total;
            } catch (e) {
                errors.push(`${pid}/${metricType}: ${e.message}`);
            }
        }
        return { results, errors };
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

    const getP = (res, pid, defaultVal = 0) => Number(res.results[pid] || defaultVal);
    const sumAcc1 = (res, field) => getP(res, "emercre") + getP(res, "emercre-488009");

    return {
        acc1: {
            maps: {
                load: sumAcc1(mapsLoadRes),
                places: sumAcc1(mapsPlacesRes),
                route: sumAcc1(mapsRouteRes),
                geocode: sumAcc1(mapsGeocodeRes)
            },
            gemini: {
                day: sumAcc1(geminiDayRes),
                month: sumAcc1(geminiMonthRes)
            },
            firestore: {
                reads: sumAcc1(fsReadsRes),
                writes: sumAcc1(fsWritesRes),
                deletes: sumAcc1(fsDeletesRes)
            }
        },
        acc2: {
            maps: {
                load: getP(mapsLoadRes, "emercre-mapsec"),
                places: getP(mapsPlacesRes, "emercre-mapsec"),
                route: getP(mapsRouteRes, "emercre-mapsec"),
                geocode: getP(mapsGeocodeRes, "emercre-mapsec")
            },
            gemini: {
                day: getP(geminiDayRes, "emercre-mapsec"),
                month: getP(geminiMonthRes, "emercre-mapsec")
            },
            firestore: {
                reads: getP(fsReadsRes, "emercre-mapsec"),
                writes: getP(fsWritesRes, "emercre-mapsec"),
                deletes: getP(fsDeletesRes, "emercre-mapsec")
            }
        },
        syncErrors: allErrors,
        // V.15.2.0: Nuevo modelo de precios por SKU (Marzo 2025)
        freeTiers: {
            maps_load: 10000,   // Dynamic Maps — Essentials
            geocode:   10000,   // Geocoding — Essentials
            places:    10000,   // Places — Essentials
            route:     0        // Directions — Legacy (sin free tier)
        },
        cpmRates: {             // $/1000 peticiones (tras superar free tier)
            maps_load: 7.00,
            geocode:   5.00,
            places:    5.00,
            route:     5.00
        },
        pricingModel: 'per_sku_2025'
    };
});

// 3.5. Create User (V.15.1.0 - Server-side user creation with role verification)
exports.createUser = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Debe estar autenticado.");
    }

    // Verify caller's role
    const callerSnap = await admin.firestore().collection("users").doc(context.auth.uid).get();
    const callerRole = callerSnap.exists ? callerSnap.data().role : null;

    if (!['super_admin', 'manager'].includes(callerRole)) {
        throw new functions.https.HttpsError("permission-denied", "Sin permisos para crear usuarios.");
    }

    // Managers can only create 'admin' and 'usuario' roles
    if (callerRole === 'manager' && !['admin', 'usuario'].includes(data.role)) {
        throw new functions.https.HttpsError("permission-denied", "Un manager solo puede crear roles admin y usuario.");
    }

    // Validate required fields
    if (!data.email || !data.password || !data.nombre) {
        throw new functions.https.HttpsError("invalid-argument", "Email, contraseña y nombre son obligatorios.");
    }

    if (data.password.length < 6) {
        throw new functions.https.HttpsError("invalid-argument", "La contraseña debe tener al menos 6 caracteres.");
    }

    try {
        // Create Firebase Auth account
        const userRecord = await admin.auth().createUser({
            email: data.email,
            password: data.password,
            displayName: data.nombre
        });

        // Create Firestore user document
        await admin.firestore().collection("users").doc(userRecord.uid).set({
            nombre: data.nombre,
            email: data.email,
            role: data.role || 'usuario',
            provincia: data.provincia || 'Andalucía',
            activo: data.activo !== false,
            canSeeVehicles: !!data.canSeeVehicles,
            accesoEmergencias: data.accesoEmergencias !== false,
            accesoPreventivos: !!data.accesoPreventivos,
            aparecerEnTodosLosChats: !!data.aparecerEnTodosLosChats,
            creadoPor: context.auth.uid,
            creadoEn: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`[createUser] Usuario ${data.email} creado por ${context.auth.token.email}`);
        return { uid: userRecord.uid };
    } catch (error) {
        console.error("[createUser] Error:", error);
        if (error.code === 'auth/email-already-exists') {
            throw new functions.https.HttpsError("already-exists",
                "Este correo ya está dado de alta. Al borrar un usuario, queda un rastro en Firebase. Dile al usuario que vuelva a iniciar sesión con su cuenta de siempre y nosotros reactivaremos su perfil.");
        }
        throw new functions.https.HttpsError("internal", "Error al crear usuario: " + error.message);
    }
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

// Cache global para reducir lecturas de vehículos estáticos
let vehiculosCache = {};
let vehiculosCacheTime = {};

// 5. Monitor Oysta Vehicles (V.15.0.0)
// Detecta llegadas y salidas en segundo plano cada 2 minutos.
// Solo procesa intervenciones PREVENTIVAS. No seguimiento de emergencias en BG.
exports.monitorOystaVehicles = functions.pubsub.schedule('every 2 minutes').onRun(async (context) => {
    const db = admin.firestore();
    const bridgeUrl = process.env.OYSTA_BRIDGE_URL || "https://script.google.com/macros/s/AKfycbw3-xw3BPvvHIagopXlcvd4fzHgSs_BUlv6-CbiP4ZhtivoIiltxx1QkcS6d7AF45f2/exec";
    if (!bridgeUrl) return null;

    try {
        // 1. Lectura inteligente y ultra-ligera: Solo consultamos preventivos activos.
        // BUG FIX (V.15.0.16): Usar .select() para reducir el tamaño de descarga de cada documento 
        // al mínimo absoluto (solo campos necesarios).
        const rawIntsSnap = await db.collectionGroup("intervenciones")
            .where("abierta", "==", true)
            .select("recursosAsignados", "coords", "direccion", "comentarios")
            .get();

        // 1.5. Filtrar intervenciones cuyos preventivos padres estén realmente abiertos (V.14.1.3)
        const activeIntDocs = [];
        if (!rawIntsSnap.empty) {
            const prevIds = new Set();
            rawIntsSnap.docs.forEach(doc => {
                const parts = doc.ref.path.split('/');
                if (parts.length >= 2) prevIds.add(parts[1]); // preventivos/{id}/...
            });

            if (prevIds.size > 0) {
                // Consultamos el estado de los preventivos padres (solo el campo abierta)
                const prevSnaps = await Promise.all(Array.from(prevIds).map(pid => 
                    db.collection("preventivos").doc(pid).get()
                ));
                const openPrevs = new Set();
                prevSnaps.forEach(s => {
                    // Un preventivo se considera abierto si existe y 'abierta' no es explícitamente false
                    if (s.exists && s.data().abierta !== false) openPrevs.add(s.id);
                });

                rawIntsSnap.docs.forEach(doc => {
                    const parts = doc.ref.path.split('/');
                    if (openPrevs.has(parts[1])) activeIntDocs.push(doc);
                });
            }
        }

        // BUG FIX (V.15.0.0): Salimos si no hay preventivos activos.
        // La existencia de emergencias con coches NO debe activar el login en Oysta.
        if (activeIntDocs.length === 0) {
            console.log("[Monitor] Sin intervenciones preventivas activas. Finalizando para ahorro de cuota Firebase.");
            return null;
        }

        // 2. Obtener mapeo de vehículos locales vinculados a Oysta.
        // BUG FIX (V.15.0.0): Solo recursos de PREVENTIVOS (no de emergencias).
        const assignedIds = new Set();
        activeIntDocs.forEach(doc => {
            (doc.data().recursosAsignados || []).forEach(rid => assignedIds.add(rid));
        });

        if (assignedIds.size === 0) {
            console.log("[Monitor] No hay recursos asignados en intervenciones preventivas abiertas. Finalizando.");
            return null;
        }

        const localVehiclesByOystaId = {};
        const missingIds = Array.from(assignedIds).filter(rid => !vehiculosCache[rid] || (Date.now() - vehiculosCacheTime[rid] > 3600000));
        
        if (missingIds.length > 0) {
            // V.15.0.16: Usamos get() directamente pero como los vehículos no cambian de peso, está bien.
            const vSnaps = await Promise.all(missingIds.map(rid => db.collection("vehiculos").doc(rid).get()));
            vSnaps.forEach(doc => {
                if (doc.exists) {
                    vehiculosCache[doc.id] = doc.data();
                    vehiculosCacheTime[doc.id] = Date.now();
                }
            });
        }
        
        assignedIds.forEach(rid => {
            const data = vehiculosCache[rid];
            if (data && data.oystaId) {
                localVehiclesByOystaId[String(data.oystaId)] = { id: rid, ...data };
            }
        });

        const oystaVehicleCount = Object.keys(localVehiclesByOystaId).length;
        if (oystaVehicleCount === 0) {
            console.log("[Monitor] Hay actividad abierta, pero ningún recurso tiene oystaId asignado. Finalizando.");
            return null;
        }

        // 3. Solo si hay trabajo Y recursos con Oysta, consultamos Oysta para ver posiciones
        const resp = await fetch(`${bridgeUrl}?u=backend-monitor`);
        if (!resp.ok) throw new Error("Oysta GAS error");
        const oystaData = await resp.json();

        // V.13.27.0: Log de login en segundo plano si el puente lo indica
        if (oystaData.loginPerformed) {
            await db.collection("oysta_logs").add({
                fecha: admin.firestore.FieldValue.serverTimestamp(),
                usuario: "Oysta (BG)",
                tipo: "Oysta",
                detalle: oystaData.loginInfo || "Login automático por monitor de fondo"
            });
        }

        if (!oystaData.vehicles) return null;

        const vehiclesMap = {};
        oystaData.vehicles.forEach(v => { vehiclesMap[String(v.id)] = v; });

        const now = Date.now();
        let diagnosticLogged = false;

        // 4. Obtener todos los estados agregados en batch.
        // BUG FIX (V.15.0.0): usa activeIntDocs (correcto) en lugar de activeIntsSnap (no definido).
        const intStateRefs = activeIntDocs.map(doc => db.collection("oysta_vehicle_states").doc(`prev_${doc.id}`));
        const allStatesSnaps = intStateRefs.length > 0 ? await db.getAll(...intStateRefs) : [];
        const statesMap = {};
        allStatesSnaps.forEach(snap => {
            statesMap[snap.id] = snap.exists ? snap.data() : {};
        });

        // --- PROCESAR PREVENTIVOS ---
        for (const intDoc of activeIntDocs) {
            const iData = intDoc.data();
            const iRef = intDoc.ref;
            const docKey = `prev_${iRef.id}`;
            const intStates = statesMap[docKey] || {};
            let intStatesChanged = false;

            const iCoords = iData.coords;
            const intAssignedIds = iData.recursosAsignados || [];

            for (const rid of intAssignedIds) {
                const oystaId = Object.keys(localVehiclesByOystaId).find(key => localVehiclesByOystaId[key].id === rid);
                const v = oystaId ? vehiclesMap[oystaId] : null;
                if (!v) continue;

                const pos = { lat: parseFloat(v.lat), lng: parseFloat(v.lng) };
                const speed = parseFloat(v.speed);
                // V.15.0.0: Detección de movimiento
                let isMoving = speed > 3;
                if (v.status && v.status.toUpperCase().includes("MOVING")) isMoving = true;
                if (v.moving === true || v.moving === "true") isMoving = true;

                // Detección de estado Parado explícito
                let isStoppedExplicit = false;
                if (v.status) {
                    const st = v.status.toUpperCase();
                    if (st.includes("STOP") || st.includes("PARAD")) isStoppedExplicit = true;
                }

                const distToDest = iCoords ? calculateHaversineDist(pos, iCoords) : 999;
                const hasRealDest = (iData.direccion && iData.direccion.trim() !== "" && iData.direccion.toLowerCase() !== "destino");
                const isGoal = hasRealDest && (distToDest < 0.05); // Radio 50m

                // Lógica de mantenimiento de viaje:
                // Si ha llegado a la meta (menos de 50m), forzamos parada.
                if (isGoal) {
                    isMoving = false;
                } 
                // Si no se mueve rápido ni está explícitamente parado, 
                // asumimos Ralentí/Semáforo y mantenemos el estado de ruta anterior
                else if (!isMoving && !isStoppedExplicit) {
                    isMoving = vs.moving;
                }

                // V.15.0.16: ELIMINADO log de diagnóstico basura que insertaba un documento por ciclo.

                const indicativo = localVehiclesByOystaId[oystaId].alias || localVehiclesByOystaId[oystaId].indicativo || v.name;

                const oystaTsStr = v.last_pos ? v.last_pos.replace(' ', 'T') : null;
                const oystaTime = oystaTsStr ? new Date(oystaTsStr).getTime() : now;

                const vs = intStates[rid] || { moving: isMoving, hasDeparted: false, hasArrived: false, lastStopAddr: "" };
                let vehicleStateChanged = false;

                // Reset de arribo agresivo (V.15.0.0: resetea siempre > 250m para evitar botes)
                if (vs.hasArrived && distToDest > 0.25) {
                    vs.hasArrived = false;
                    vehicleStateChanged = true;
                }

                // --- NUEVA LÓGICA V.15.0.0 (Reglas de Casos A, B y C) ---
                
                // 1. DETECCIÓN DE SALIDA (Inicia movimiento o reinicia tras parada)
                if (isMoving && (!vs.moving || !vs.hasDeparted)) {
                    // Evitar duplicados si el monitor re-procesa el mismo evento exacto
                    const alreadySent = (iData.comentarios || []).some(c => 
                        c.timestamp === oystaTime && c.texto.includes("sale desde")
                    );
                    
                    if (!alreadySent) {
                        const addrStr = `[${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}] (Ver mapa: https://www.google.com/maps?q=${pos.lat},${pos.lng})`;
                        const target = iData.direccion || "destino";
                        const msg = `${indicativo} sale desde ${addrStr} hacia ${target}`;
                        
                        const newComm = {
                            texto: msg,
                            coords: pos,
                            autor: 'Sist. Oysta (BG)',
                            autorId: 'system',
                            timestamp: oystaTime,
                            fecha: formatCommentFecha(new Date(oystaTime))
                        };
                        
                        await iRef.update({
                            comentarios: admin.firestore.FieldValue.arrayUnion(newComm),
                            actualizadoEn: admin.firestore.FieldValue.serverTimestamp()
                        });
                        
                        // Guardamos datos para edición retroactiva posterior (Caso B/C)
                        vs.lastSaleTs = oystaTime;
                        vs.lastSaleAddr = addrStr;
                        vs.hasDeparted = true;
                        vs.hasArrived = false;
                        vs.moving = true;
                        vehicleStateChanged = true;

                        await db.collection("oysta_logs").add({
                            fecha: admin.firestore.FieldValue.serverTimestamp(),
                            usuario: "Sist. Oysta (BG)", tipo: "Oysta", detalle: msg
                        });
                    }
                }
                
                // 2. DETECCIÓN DE LLEGADA / PARADA (Se detiene tras estar en movimiento)
                else if (!isMoving && vs.moving) {
                    let msg = "";
                    
                    if (isGoal) {
                        // CASO A: Llegada al destino final de la intervención (O si < 50m)
                        msg = `${indicativo} llega a lugar del aviso (${iData.direccion || 'sin dirección'})`;
                        vs.hasArrived = true;
                    } else {
                        // CASO B/C: Parada intermedia (Estado PARADO detectado explícitamente)
                        const addrStr = `[${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}] (Ver mapa: https://www.google.com/maps?q=${pos.lat},${pos.lng})`;
                        msg = `${indicativo} llega a ${addrStr}`;
                        
                        // Edición retroactiva del mensaje de salida previo si el destino era desconocido
                        if (vs.lastSaleTs && vs.lastSaleAddr) {
                            const currentComms = [...(iData.comentarios || [])];
                            const idx = currentComms.findIndex(c => c.timestamp === vs.lastSaleTs && c.autorId === 'system');
                            if (idx !== -1) {
                                const oldText = currentComms[idx].texto;
                                const newSaleText = `${indicativo} sale desde ${vs.lastSaleAddr} hacia ${addrStr}`;
                                if (oldText !== newSaleText) {
                                    currentComms[idx].texto = newSaleText;
                                    await iRef.update({ comentarios: currentComms });
                                }
                            }
                        }
                    }
                    
                    await iRef.update({
                        comentarios: admin.firestore.FieldValue.arrayUnion({
                            texto: msg,
                            coords: pos,
                            autor: 'Sist. Oysta (BG)',
                            autorId: 'system',
                            timestamp: oystaTime,
                            fecha: formatCommentFecha(new Date(oystaTime))
                        }),
                        actualizadoEn: admin.firestore.FieldValue.serverTimestamp()
                    });
                    
                    vs.moving = false;
                    vehicleStateChanged = true;

                    await db.collection("oysta_logs").add({
                        fecha: admin.firestore.FieldValue.serverTimestamp(),
                        usuario: "Oysta (BG)", tipo: "Oysta", detalle: msg
                    });
                }
                // V.15.0.16: ELIMINADO log de cambio de estado silencioso para ahorrar costes.
                else if (isMoving !== vs.moving) {
                    vs.moving = isMoving;
                    vehicleStateChanged = true;
                }

                if (vehicleStateChanged) {
                    intStates[rid] = vs;
                    intStatesChanged = true;
                }
            }

            if (intStatesChanged) {
                await db.collection("oysta_vehicle_states").doc(docKey).set(intStates, { merge: true });
            }
        }

        /* V.15.0.16: ELIMINADO log de latido "Monitor activo: Supervisando X recursos..." 
           que generaba 720 documentos inútiles al día en Firestore. */
        
        return null;

    } catch (err) {
        console.error("Monitor Oysta Error:", err);
        return null;
    }
});

async function checkExistingAction(db, opId, indicativo, partialText) {
    const snap = await db.collection("operaciones").doc(opId).collection("acciones")
        .where("texto", ">=", `⚡️ ${indicativo}`) // Intento de optimización
        .get();
    return snap.docs.some(d => d.data().texto?.includes(indicativo) && d.data().texto?.includes(partialText));
}

function calculateHaversineDist(pos1, pos2) {
    if (!pos1 || !pos2) return 999;
    const R = 6371; // km
    const dLat = (pos2.lat - pos1.lat) * Math.PI / 180;
    const dLon = (pos2.lng - pos1.lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(pos1.lat * Math.PI / 180) * Math.cos(pos2.lat * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function formatCommentFecha(d) {
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hour = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hour}:${min}`;
}

// V.15.0.15: Función getReverseGeocoding eliminada en su totalidad del backend para supresión 
// completa de consumo de Google Maps. Ahora el backend emite unívocamente coordenadas
// crudas y el Frontend (UI) recae en la labor del enriquecimiento con "lazy/negative cache".

