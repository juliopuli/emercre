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

    const bridgeUrl = process.env.OYSTA_BRIDGE_URL;
    if (!bridgeUrl) {
        throw new functions.https.HttpsError("internal", "Oysta bridge URL no configurada en el servidor.");
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
        const duration = 14000;
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
                BoundingBoxes: [[[-90, -180], [90, 180]]],
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

                if (msg.Message && msg.Message.PositionReport) {
                    sog = msg.Message.PositionReport.Sog;
                } else if (msg.Message && msg.Message.StandardClassBPositionReport) {
                    sog = msg.Message.StandardClassBPositionReport.Sog;
                }

                let shipType = 0;
                if (msg.MessageType === "ShipStaticData" && msg.Message && msg.Message.ShipStaticData) {
                    shipType = msg.Message.ShipStaticData.ShipType;
                }

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

    const stringData = {};
    Object.keys(dataPayload).forEach(k => {
        stringData[k] = String(dataPayload[k]);
    });

    const LOGO_URL = "https://juliopuli.github.io/emercre/assets/logo_emercre.png";

    const results = await Promise.allSettled(
        tokens.map(token =>
            admin.messaging().send({
                token: token,
                data: {
                    ...stringData,
                    title: title,
                    body: body
                },
                android: {
                    priority: "high"
                },
                webpush: {
                    headers: { Urgency: "high" },
                    fcm_options: {
                        link: stringData.chatFrom
                            ? `https://juliopuli.github.io/emercre/?chat=${stringData.chatFrom}`
                            : "https://juliopuli.github.io/emercre/"
                    }
                },
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
const { BigQuery } = require("@google-cloud/bigquery");
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
    const targetProjectIds = ["emercre", "emercre-488009", "emercre-mapsec"];

    const monitoringClient = new monitoring.MetricServiceClient({ credentials: key });

    const now = Math.floor(Date.now() / 1000);
    const startOfMonth = Math.floor(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000);
    const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);

    const getMetric = async (serviceLabel, startTime) => {
        let results = {};
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

    const getExactBillingCost = async () => {
        let exactCostAcc1 = null;
        let exactCostAcc2 = null;
        let errorMsg = null;

        try {
            // -- CUENTA 1 (emercre + emercre-488009) --
            // La tabla de BQ vive en emercre-488009 porque ahí apunta el export de facturación
            const bqClient1 = new BigQuery({ credentials: key, projectId: "emercre-488009" });
            const [tables1] = await bqClient1.dataset('billing_export').getTables();
            const billingTable1 = tables1.find(t => t.id.includes('gcp_billing_export_v1_'));

            if (billingTable1) {
                const tableId1 = `emercre-488009.billing_export.${billingTable1.id}`;
                const query1 = `
                    SELECT project.id as projectId, SUM(cost) as total_cost
                    FROM \`${tableId1}\`
                    WHERE usage_start_time >= TIMESTAMP_TRUNC(CURRENT_TIMESTAMP(), MONTH)
                    GROUP BY project.id
                `;
                const [rows1] = await bqClient1.query({ query: query1 });
                const bqTotal = rows1
                    .filter(r => ['emercre', 'emercre-488009'].includes(r.projectId))
                    .reduce((acc, row) => acc + (row.total_cost || 0), 0);
                // Solo asignamos si hay datos reales (> 0), si no dejamos null
                // para que el frontend no muestre $0.00 cuando BQ aún está vacío
                exactCostAcc1 = bqTotal > 0 ? bqTotal : null;
            } else {
                errorMsg = "bq_table_not_found (Acc1)";
            }

            // -- CUENTA 2 (emercre-mapsec) --
            const bqClient2 = new BigQuery({ credentials: key, projectId: "emercre-mapsec" });
            const [tables2] = await bqClient2.dataset('billing_export_acc2').getTables();
            const billingTable2 = tables2.find(t => t.id.includes('gcp_billing_export_v1_'));

            if (billingTable2) {
                const tableId2 = `emercre-mapsec.billing_export_acc2.${billingTable2.id}`;
                const query2 = `
                    SELECT SUM(cost) as total_cost
                    FROM \`${tableId2}\`
                    WHERE usage_start_time >= TIMESTAMP_TRUNC(CURRENT_TIMESTAMP(), MONTH)
                `;
                const [rows2] = await bqClient2.query({ query: query2 });
                if (rows2 && rows2.length > 0) {
                    exactCostAcc2 = rows2[0].total_cost || 0;
                }
            } else {
                errorMsg = errorMsg ? "bq_table_not_found (Ambas)" : "bq_table_not_found (Acc2)";
            }

        } catch (e) {
            errorMsg = e.message;
            console.warn("No se pudo obtener el coste exacto de BigQuery:", e.message);
        }

        return { acc1: exactCostAcc1, acc2: exactCostAcc2, bqError: errorMsg };
    };

    // Consultamos datos reales
    const [
        mapsLoadRes, mapsPlacesRes, mapsRouteRes, mapsGeocodeRes,
        geminiDayRes, geminiMonthRes,
        fsReadsRes, fsWritesRes, fsDeletesRes,
        billingRes
    ] = await Promise.all([
        getMetric("maps-backend.googleapis.com", startOfMonth),
        getMetric("places-backend.googleapis.com", startOfMonth),
        getMetric("routes.googleapis.com", startOfMonth),
        getMetric("geocoding-backend.googleapis.com", startOfMonth),
        getMetric("generativelanguage.googleapis.com", startOfDay),
        getMetric("generativelanguage.googleapis.com", startOfMonth),
        getFirestoreMetric("firestore.googleapis.com/document/read_ops_count", startOfDay),
        getFirestoreMetric("firestore.googleapis.com/document/write_ops_count", startOfDay),
        getFirestoreMetric("firestore.googleapis.com/document/delete_ops_count", startOfDay),
        getExactBillingCost()
    ]);

    const allErrors = [
        ...mapsLoadRes.errors, ...mapsPlacesRes.errors, ...mapsRouteRes.errors, ...mapsGeocodeRes.errors,
        ...geminiDayRes.errors, ...fsReadsRes.errors, ...fsWritesRes.errors, ...fsDeletesRes.errors
    ];

    const getP = (res, pid, defaultVal = 0) => Number(res.results[pid] || defaultVal);
    const sumAcc1 = (res) => getP(res, "emercre") + getP(res, "emercre-488009");

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
        freeTiers: {
            maps_load: 10000,
            geocode:   10000,
            places:    10000,
            route:     10000
        },
        cpmRates: {
            maps_load: 7.00,
            geocode:   5.00,
            places:    5.00,
            route:     5.00
        },
        exactBillingCost: {
            acc1: billingRes.acc1,
            acc2: billingRes.acc2,
            bqError: billingRes.bqError
        },
        pricingModel: 'per_sku_2025'
    };
});

// 3.5. Create User (V.15.1.0 - Server-side user creation with role verification)
exports.createUser = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Debe estar autenticado.");
    }

    const callerSnap = await admin.firestore().collection("users").doc(context.auth.uid).get();
    const callerRole = callerSnap.exists ? callerSnap.data().role : null;

    if (!['super_admin', 'manager'].includes(callerRole)) {
        throw new functions.https.HttpsError("permission-denied", "Sin permisos para crear usuarios.");
    }

    if (callerRole === 'manager' && !['admin', 'usuario'].includes(data.role)) {
        throw new functions.https.HttpsError("permission-denied", "Un manager solo puede crear roles admin y usuario.");
    }

    if (!data.email || !data.password || !data.nombre) {
        throw new functions.https.HttpsError("invalid-argument", "Email, contraseña y nombre son obligatorios.");
    }

    if (data.password.length < 6) {
        throw new functions.https.HttpsError("invalid-argument", "La contraseña debe tener al menos 6 caracteres.");
    }

    try {
        const userRecord = await admin.auth().createUser({
            email: data.email,
            password: data.password,
            displayName: data.nombre
        });

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
    if (!context.auth) {
        throw new functions.https.HttpsError(
            "unauthenticated",
            "El usuario debe estar autenticado para purgar logs."
        );
    }

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
exports.monitorOystaVehicles = functions.pubsub.schedule('every 2 minutes').onRun(async (context) => {
    const db = admin.firestore();
    const bridgeUrl = process.env.OYSTA_BRIDGE_URL || "https://script.google.com/macros/s/AKfycbw3-xw3BPvvHIagopXlcvd4fzHgSs_BUlv6-CbiP4ZhtivoIiltxx1QkcS6d7AF45f2/exec";
    if (!bridgeUrl) return null;

    try {
        const rawIntsSnap = await db.collectionGroup("intervenciones")
            .where("abierta", "==", true)
            .select("recursosAsignados", "coords", "direccion", "comentarios")
            .get();

        const activeIntDocs = [];
        if (!rawIntsSnap.empty) {
            const prevIds = new Set();
            rawIntsSnap.docs.forEach(doc => {
                const parts = doc.ref.path.split('/');
                if (parts.length >= 2) prevIds.add(parts[1]);
            });

            if (prevIds.size > 0) {
                const prevSnaps = await Promise.all(Array.from(prevIds).map(pid => 
                    db.collection("preventivos").doc(pid).get()
                ));
                const openPrevs = new Set();
                prevSnaps.forEach(s => {
                    if (s.exists && s.data().abierta !== false) openPrevs.add(s.id);
                });

                rawIntsSnap.docs.forEach(doc => {
                    const parts = doc.ref.path.split('/');
                    if (openPrevs.has(parts[1])) activeIntDocs.push(doc);
                });
            }
        }

        if (activeIntDocs.length === 0) {
            console.log("[Monitor] Sin intervenciones preventivas activas. Finalizando para ahorro de cuota Firebase.");
            return null;
        }

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

        const resp = await fetch(`${bridgeUrl}?u=backend-monitor`);
        if (!resp.ok) throw new Error("Oysta GAS error");
        const oystaData = await resp.json();

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

        const intStateRefs = activeIntDocs.map(doc => db.collection("oysta_vehicle_states").doc(`prev_${doc.id}`));
        const allStatesSnaps = intStateRefs.length > 0 ? await db.getAll(...intStateRefs) : [];
        const statesMap = {};
        allStatesSnaps.forEach(snap => {
            statesMap[snap.id] = snap.exists ? snap.data() : {};
        });

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
                let isMoving = speed > 3;
                if (v.status && v.status.toUpperCase().includes("MOVING")) isMoving = true;
                if (v.moving === true || v.moving === "true") isMoving = true;

                let isStoppedExplicit = false;
                if (v.status) {
                    const st = v.status.toUpperCase();
                    if (st.includes("STOP") || st.includes("PARAD")) isStoppedExplicit = true;
                }

                const distToDest = iCoords ? calculateHaversineDist(pos, iCoords) : 999;
                const hasRealDest = (iData.direccion && iData.direccion.trim() !== "" && iData.direccion.toLowerCase() !== "destino");
                const isGoal = hasRealDest && (distToDest < 0.05);

                if (isGoal) {
                    isMoving = false;
                } else if (!isMoving && !isStoppedExplicit) {
                    isMoving = vs.moving;
                }

                const indicativo = localVehiclesByOystaId[oystaId].alias || localVehiclesByOystaId[oystaId].indicativo || v.name;

                const oystaTsStr = v.last_pos ? v.last_pos.replace(' ', 'T') : null;
                const oystaTime = oystaTsStr ? new Date(oystaTsStr).getTime() : now;

                const vs = intStates[rid] || { moving: isMoving, hasDeparted: false, hasArrived: false, lastStopAddr: "" };
                let vehicleStateChanged = false;

                if (vs.hasArrived && distToDest > 0.25) {
                    vs.hasArrived = false;
                    vehicleStateChanged = true;
                }

                if (isMoving && (!vs.moving || !vs.hasDeparted)) {
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
                else if (!isMoving && vs.moving) {
                    let msg = "";
                    
                    if (isGoal) {
                        msg = `${indicativo} llega a lugar del aviso (${iData.direccion || 'sin dirección'})`;
                        vs.hasArrived = true;
                    } else {
                        const addrStr = `[${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}] (Ver mapa: https://www.google.com/maps?q=${pos.lat},${pos.lng})`;
                        msg = `${indicativo} llega a ${addrStr}`;
                        
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

        return null;

    } catch (err) {
        console.error("Monitor Oysta Error:", err);
        return null;
    }
});

async function checkExistingAction(db, opId, indicativo, partialText) {
    const snap = await db.collection("operaciones").doc(opId).collection("acciones")
        .where("texto", ">=", `⚡️ ${indicativo}`)
        .get();
    return snap.docs.some(d => d.data().texto?.includes(indicativo) && d.data().texto?.includes(partialText));
}

function calculateHaversineDist(pos1, pos2) {
    if (!pos1 || !pos2) return 999;
    const R = 6371;
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
