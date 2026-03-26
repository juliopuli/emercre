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
        syncErrors: allErrors
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

// Cache global para reducir lecturas de vehículos estáticos
let vehiculosCache = {};
let vehiculosCacheTime = {};

// 5. Monitor Oysta Vehicles (V.14.7.2)
// Detecta llegadas y salidas en segundo plano cada 2 minutos.
// Solo procesa intervenciones PREVENTIVAS. No seguimiento de emergencias en BG.
exports.monitorOystaVehicles = functions.pubsub.schedule('every 2 minutes').onRun(async (context) => {
    const db = admin.firestore();
    const bridgeUrl = process.env.OYSTA_BRIDGE_URL;
    if (!bridgeUrl) return null;

    try {
        // 1. Lectura inteligente: Solo consultamos preventivos activos.
        // BUG FIX (V.14.7.2): No consultamos emergencias porque no se hace seguimiento en BG.
        const rawIntsSnap = await db.collectionGroup("intervenciones").where("abierta", "==", true).get();

        // 1.5. Filtrar intervenciones cuyos preventivos padres estén realmente abiertos (V.14.1.3)
        const activeIntDocs = [];
        if (!rawIntsSnap.empty) {
            const prevIds = new Set();
            rawIntsSnap.docs.forEach(doc => {
                const parts = doc.ref.path.split('/');
                if (parts.length >= 2) prevIds.add(parts[1]); // preventivos/{id}/...
            });

            if (prevIds.size > 0) {
                // Consultamos el estado de los preventivos padres
                const prevSnaps = await Promise.all(Array.from(prevIds).map(pid => db.collection("preventivos").doc(pid).get()));
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

        // BUG FIX (V.14.7.2): Salimos si no hay preventivos activos.
        // La existencia de emergencias con coches NO debe activar el login en Oysta.
        if (activeIntDocs.length === 0) {
            console.log("[Monitor] Sin intervenciones preventivas activas. Finalizando para ahorro de cuota Firebase.");
            return null;
        }

        // 2. Obtener mapeo de vehículos locales vinculados a Oysta.
        // BUG FIX (V.14.7.2): Solo recursos de PREVENTIVOS (no de emergencias).
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
        // BUG FIX (V.14.7.2): usa activeIntDocs (correcto) en lugar de activeIntsSnap (no definido).
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
                // V.14.7.2: Detección más robusta. Si Oysta no envía speed, intentamos detectar por status o movimiento
                let isMoving = speed > 3;
                if (v.status && v.status.toUpperCase().includes("MOVING")) isMoving = true;
                if (v.moving === true || v.moving === "true") isMoving = true;

                // Log de diagnóstico temporal (V.14.7.2): logueamos las claves del primer objeto que veamos
                if (!diagnosticLogged) {
                    await db.collection("oysta_logs").add({
                        fecha: admin.firestore.FieldValue.serverTimestamp(), usuario: "Sist. Debug", tipo: "Debug",
                        detalle: `[Diagnóstico Raw] Claves Oysta: ${Object.keys(v).join(', ')}. Speed: ${v.speed}. Status: ${v.status}. Name: ${v.name}.`
                    });
                    diagnosticLogged = true;
                }

                const indicativo = localVehiclesByOystaId[oystaId].alias || localVehiclesByOystaId[oystaId].indicativo || v.name;

                const oystaTsStr = v.last_pos ? v.last_pos.replace(' ', 'T') : null;
                const oystaTime = oystaTsStr ? new Date(oystaTsStr).getTime() : now;

                const vs = intStates[rid] || { moving: isMoving, hasDeparted: false, hasArrived: false, lastStopAddr: "" };
                const distToDest = iCoords ? calculateHaversineDist(pos, iCoords) : 999;
                let vehicleStateChanged = false;

                // Reset de arribo agresivo (V.14.7.2: resetea siempre > 150m sin depender de isMoving)
                if (vs.hasArrived && distToDest > 0.15) {
                    vs.hasArrived = false;
                    vehicleStateChanged = true;
                }

                const MSG_SALE = `⚡️ ${indicativo} SALE hacia ${iData.direccion || 'el lugar'}.`;
                const MSG_LLEGADA = `✅ ${indicativo} LLEGADA al lugar (${iData.direccion || 'sin dirección'}).`;
                const MSG_REANUDA = `⚡️ ${indicativo} REANUDA marcha hacia el lugar.`;
                const MSG_PARADA = `⚡️ ${indicativo} PARADA en trayecto.`;

                // 1. Salida Inicial
                if (isMoving && !vs.hasDeparted) {
                    const searchPattern = `⚡️ ${indicativo.toUpperCase()} SALE `;
                    const exists = (iData.comentarios || []).some(c => {
                        if (!c.texto) return false;
                        const t = c.texto.toUpperCase();
                        return t.includes(searchPattern) || t.includes("INTERVENCIÓN INICIADA");
                    });
                    if (!exists) {
                        await iRef.update({
                            comentarios: admin.firestore.FieldValue.arrayUnion({
                                texto: MSG_SALE, autor: 'Sist. Oysta (BG)', autorId: 'system', timestamp: oystaTime, fecha: formatCommentFecha(new Date(oystaTime))
                            })
                        });
                        await db.collection("oysta_logs").add({
                            fecha: admin.firestore.FieldValue.serverTimestamp(),
                            usuario: "Sist. Oysta (BG)",
                            tipo: "Oysta",
                            detalle: MSG_SALE
                        });
                    } else {
                        // Log de depuración (V.14.7.2)
                        await db.collection("oysta_logs").add({
                            fecha: admin.firestore.FieldValue.serverTimestamp(), usuario: "Sist. Debug", tipo: "Debug",
                            detalle: `Bloqueado SALE duplicado para ${indicativo}.`
                        });
                    }
                    vs.hasDeparted = true;
                    vs.moving = true;
                    vehicleStateChanged = true;
                }
                // 2. Llegada Final (Radio aumentado a 100m en V.14.7.2)
                else if (!isMoving && distToDest < 0.1 && !vs.hasArrived && vs.hasDeparted) {
                    const exists = (iData.comentarios || []).some(c => {
                        if (!c.texto) return false;
                        const t = c.texto.toUpperCase();
                        // Match exacto con prefijo ⚡️ para evitar colisiones (V.14.7.2)
                        const searchPattern = `⚡️ ${indicativo.toUpperCase()}`;
                        return t.includes(searchPattern) && t.includes("LLEGADA AL LUGAR");
                    });
                    if (!exists) {
                        const text = `✅ ${indicativo} LLEGADA al lugar (${iData.direccion || 'sin dirección'}).`;
                        await iRef.update({
                            comentarios: admin.firestore.FieldValue.arrayUnion({
                                texto: text, autor: 'Sist. Oysta (BG)', autorId: 'system', timestamp: oystaTime, fecha: formatCommentFecha(new Date(oystaTime))
                            })
                        });
                        await db.collection("oysta_logs").add({
                            fecha: admin.firestore.FieldValue.serverTimestamp(),
                            usuario: "Oysta (BG)",
                            tipo: "Oysta",
                            detalle: text
                        });
                    }
                    vs.hasArrived = true;
                    vs.moving = false;
                    vehicleStateChanged = true;
                }
                          // 3. Seguimiento Intermedio (Trayecto)
                else if (vs.hasDeparted && !vs.hasArrived) {
                    const comms = iData.comentarios || [];
                    let lastActionStr = "";
                    const searchPattern = `⚡️ ${indicativo.toUpperCase()}`; // Seguimiento siempre tiene rayo
                    for (let k = comms.length - 1; k >= 0; k--) {
                        const t = (comms[k].texto || "").toUpperCase();
                        if (t.includes(searchPattern)) {
                            lastActionStr = t;
                            break;
                        }
                    }

                    if (isMoving && !vs.moving && distToDest > 0.1) {
                        // REANUDA marcha (V.14.7.2: Frases exactas)
                        const isAlreadyMovingMsg = lastActionStr.includes(" REANUDA MARCHA ") || lastActionStr.includes(" EN MOVIMIENTO ") || lastActionStr.includes(" SALE HACIA ");
                        if (!isAlreadyMovingMsg) {
                            await iRef.update({
                                comentarios: admin.firestore.FieldValue.arrayUnion({
                                    texto: MSG_REANUDA, coords: pos, autor: 'Sist. Oysta (BG)', autorId: 'system', timestamp: oystaTime, fecha: formatCommentFecha(new Date(oystaTime))
                                })
                            });
                            await db.collection("oysta_logs").add({
                                fecha: admin.firestore.FieldValue.serverTimestamp(),
                                usuario: "Oysta (BG)",
                                tipo: "Oysta",
                                detalle: MSG_REANUDA
                            });
                        } else {
                            await db.collection("oysta_logs").add({
                                fecha: admin.firestore.FieldValue.serverTimestamp(), usuario: "Sist. Debug", tipo: "Debug",
                                detalle: `Bloqueado REANUDA duplicado para ${indicativo}.`
                            });
                        }
                        vs.moving = true;
                        vehicleStateChanged = true;
                    } else if (!isMoving && vs.moving && distToDest > 0.1) {
                        // Parada en trayecto (V.14.7.2)
                        const isAlreadyStoppedMsg = lastActionStr.includes(" PARADA EN TRAYECTO.") || lastActionStr.includes(" LLEGADA AL LUGAR") || lastActionStr.includes(" SE HA DETENIDO");
                        if (!isAlreadyStoppedMsg) {
                            await iRef.update({ 
                                comentarios: admin.firestore.FieldValue.arrayUnion({
                                    texto: MSG_PARADA, coords: pos, autor: 'Sist. Oysta (BG)', autorId: 'system', timestamp: oystaTime, fecha: formatCommentFecha(new Date(oystaTime))
                                }),
                                actualizadoEn: admin.firestore.FieldValue.serverTimestamp() 
                            });
                            await db.collection("oysta_logs").add({
                                fecha: admin.firestore.FieldValue.serverTimestamp(),
                                usuario: "Oysta (BG)",
                                tipo: "Oysta",
                                detalle: MSG_PARADA
                            });
                        } else {
                            await db.collection("oysta_logs").add({
                                fecha: admin.firestore.FieldValue.serverTimestamp(), usuario: "Sist. Debug", tipo: "Debug",
                                detalle: `Bloqueado PARADA duplicada para ${indicativo}.`
                            });
                        }
                        vs.moving = false;
                        vs.lastStopAddr = "parada anterior";
                        vehicleStateChanged = true;
                    } else if (isMoving !== vs.moving) {
                        // V.14.7.2: Restaurar log de cambio de estado para visibilidad del usuario
                        await db.collection("oysta_logs").add({
                            fecha: admin.firestore.FieldValue.serverTimestamp(),
                            usuario: "Sist. Oysta (BG)",
                            tipo: "Oysta",
                            detalle: `[Recurso] ${indicativo} ahora está ${isMoving ? 'EN MOVIMIENTO' : 'PARADO'} (Speed: ${v.speed || '?'}).`
                        });
                        vs.moving = isMoving;
                        vehicleStateChanged = true;
                    }
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

        if (oystaVehicleCount > 0) {
            await db.collection("oysta_logs").add({
                fecha: admin.firestore.FieldValue.serverTimestamp(),
                usuario: "Oysta (BG)",
                tipo: "Oysta",
                // BUG FIX (V.14.7.2): activeIntsSnap no existía; usa activeIntDocs.length
                detalle: `Monitor activo: Supervisando ${oystaVehicleCount} recurso(s) en ${activeIntDocs.length} int(s) preventiva(s).`
            });
        }
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

