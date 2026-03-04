/**
 * ═══════════════════════════════════════════════════════════════════
 * PUENTE DE NOTIFICACIONES PUSH — EmerCRE
 * Google Apps Script que recibe tokens FCM + datos de notificación
 * desde el cliente y envía push reales vía FCM HTTP v1 API.
 * ═══════════════════════════════════════════════════════════════════
 *
 * INSTRUCCIONES:
 * 1. Copia TODO este contenido en un proyecto nuevo de Google Apps Script
 * 2. Clic en Implementar → Nueva implementación → Aplicación web
 *    → Acceso: "Cualquier persona" → Implementar
 * 3. Copia la URL de despliegue y pégala en tu index.html (NOTIF_BRIDGE_URL)
 * ═══════════════════════════════════════════════════════════════════
 */

const FCM_PROJECT_ID = 'emercre';
const SA_EMAIL = 'emercre-push@emercre.iam.gserviceaccount.com';
// Key ID: 0c0bc6d8c5681bd35eced8006b76f0ec93231dcb (rotated 2026-03-04)
const SA_KEY = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC6DJ2utts4FNHW\nWB79pzvAGE2D820u8dgK0p1s59yDhCxZdZAxuLf32iZ6Xce4C6TQMD0CbJXv4ybC\nQvaRo5AyVRBDkm1C4dCI1/Ts9iLWsUP/9oz9J7NC4jdhpstM2bYkRIF9xxSuSoGz\nwm67+YIlfh7lSMKQf+d121hPUnK7+StEbCmCY9Ofe4EW7uOXJfCYVc82TExB/BAA\nYcMelUZj++a7aFI3eJA0H8+WCTYvuMfAyMrF6KA8z8CPN3Ff1STnwF7hKR2EEiox\nbdyXJCBASjxgnyyyCI43Opj1krUEhXdFilbWyn4LH8p//7R5bAIghji1AI4E5BBs\njFxIXx91AgMBAAECggEABtiuxgXr/bsaGMiN/dyEDSRhpxjMTGXzx8Xeg/QQpQPd\nryqe0fCq2VwVw1OgJT7q6IDUFomEuIct2kNMkzz63l9LmU6DXPSOrYRTtc549gnk\n2I5/p92LD4a4gcdvsBiaRvyeYlqGqOqp6MGzPJF1C6/aTQ0YZa3PQ6BB0/0hptG8\nbNI/zZnLcmF69z3+RpWRwei8AfBajz6Wqf2aTFovuoAfEaca/Lu0QTycoTYpddfo\n3pNyxBcecMQ0SYGd+GzML4P8T5goNqFtrL5d6+1k2Wzaf7KEYsVT3BnHQb53mmGT\nbAZWzvIH1J29PmLf72cnjEomjMbvlsa1WF/SDF30IQKBgQDou5QJXkBazMc0JUpO\n4s13iLO10M5ligZ2qewprzHEY8Goja9Yl+Ix7SBQaMdmOqs6drHtvJ6CINJpzYfY\nOCt1x8k+SbXiy+aGEQ1r8Q9TTt8kGAIhjfPce/tPSorAt+Lf8R3xfM6B1SGOM+ga\nPABW6qeTSpU/PinCtS6YtIpzUwKBgQDMpj/jzIByG92KI9byaf327ZjIgR4eJ6uM\nic6znjTTe8TSZ1XHosvktbGIKTzCmSEGKqsA8o2WtRY2iMA+7GHtcTVuVm/aXckR\nvHYKTkMY6Hv9Jhz4KJop1s2H8FGgRP9zuOYePe/mVz00iw0AnshoaVwXUmLPP23U\nkxYb6BjRFwKBgAYuvX8GNvVyjTQwbWntEoJDamrBEkqWQRez6ectlUffUoy0vty+\npC6pWvtn3Sw1EMlrz8w9/4P7dTuET0CKNXVailkSQje1LPmQyGd+ruaKqNjfnmbf\ny4Om84UmuMrn16oVULNSmnXOgKazcE4KHAQzFaKPD6nvb9KRV5yM50SrAoGBALjF\nRZwEENh15kEJ+NEn93+Rp8coJKwvPwkFh1XO+n0TG3Koj99OUe7uSRrZuJ0uKo3p\nyjlxxXqThzm3oHNvcz8xXn9/lT/AO4FC+gR2AsijZwb5+V/pML+jzC/3P4uHoGi4\nQTR+0XHTxFQDU7sCoYj7z4TTApmB+ETchDKwDHADAoGAb23LotyChEuEnNkg9GSy\nZgTEWFpD+X6IsHkxfnyAhCTZnEpk+C5+qU3liMugXEm0GHh+9joJy34QNGT3KK1f\noCurwp6nVUUMZz36vqKrC+OofYaQA2TVW4+6zYiH7h4mOH+nf1e0k4ya7u4BKAAv\nA/TJJnX2bP7hFgYBIRg7ULg=\n-----END PRIVATE KEY-----\n';

/**
 * Maneja peticiones GET (para pruebas de conectividad)
 */
function doGet(e) {
    return ContentService.createTextOutput(
        JSON.stringify({ status: 'ok', message: 'EmerCRE Push Bridge activo' })
    ).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Maneja peticiones POST (envía push reales)
 * Espera un JSON con: { tokens: [...], titulo: "...", body: "...", data: {...} }
 */
function doPost(e) {
    try {
        const payload = JSON.parse(e.postData.contents);
        const { tokens, titulo, body, data } = payload;

        if (!tokens || tokens.length === 0) {
            return jsonResponse({ status: 'error', message: 'No hay tokens' });
        }

        const accessToken = getAccessToken();
        let sent = 0;
        let errors = 0;

        tokens.forEach(token => {
            try {
                const result = sendFCM(accessToken, token, titulo, body, data || {});
                if (result) sent++;
                else errors++;
            } catch (err) {
                Logger.log('Error enviando a token ' + token + ': ' + err);
                errors++;
            }
        });

        return jsonResponse({
            status: 'ok',
            sent: sent,
            errors: errors,
            total: tokens.length
        });

    } catch (err) {
        Logger.log('Error en doPost: ' + err);
        return jsonResponse({ status: 'error', message: err.toString() });
    }
}

/**
 * Envía una notificación FCM a un token específico usando HTTP v1 API.
 */
function sendFCM(accessToken, token, titulo, body, data) {
    const url = 'https://fcm.googleapis.com/v1/projects/' + FCM_PROJECT_ID + '/messages:send';

    // Asegurar que todos los valores de data sean strings (requisito FCM)
    const stringData = {};
    if (data) {
        Object.keys(data).forEach(k => {
            stringData[k] = String(data[k]);
        });
    }

    const message = {
        message: {
            token: token,
            notification: {
                title: titulo,
                body: body
            },
            data: stringData,
            webpush: {
                headers: {
                    Urgency: 'high'
                },
                notification: {
                    title: titulo,
                    body: body,
                    icon: 'https://juliopuli.github.io/emercre/assets/logo_emercre.png',
                    badge: 'https://juliopuli.github.io/emercre/assets/logo_emercre.png',
                    tag: 'emercre-operacion',
                    renotify: true,
                    requireInteraction: true
                },
                fcm_options: {
                    link: (stringData && stringData.chatFrom)
                        ? 'https://juliopuli.github.io/emercre/?chat=' + stringData.chatFrom
                        : 'https://juliopuli.github.io/emercre/'
                }
            }
        }
    };

    const options = {
        method: 'post',
        contentType: 'application/json',
        headers: {
            'Authorization': 'Bearer ' + accessToken
        },
        payload: JSON.stringify(message),
        muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();

    if (code === 200) {
        return true;
    } else {
        Logger.log('FCM error (' + code + '): ' + response.getContentText());
        return false;
    }
}

/**
 * Obtiene un Access Token OAuth2 usando la Service Account.
 */
function getAccessToken() {
    const now = Math.floor(Date.now() / 1000);
    const claimSet = {
        iss: SA_EMAIL,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600
    };

    const header = Utilities.base64EncodeWebSafe(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = Utilities.base64EncodeWebSafe(JSON.stringify(claimSet));
    const signatureInput = header + '.' + claim;

    const signature = Utilities.base64EncodeWebSafe(
        Utilities.computeRsaSha256Signature(signatureInput, SA_KEY)
    );

    const jwt = signatureInput + '.' + signature;

    const tokenResponse = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
        method: 'post',
        contentType: 'application/x-www-form-urlencoded',
        payload: {
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt
        },
        muteHttpExceptions: true
    });

    const tokenData = JSON.parse(tokenResponse.getContentText());
    if (tokenData.access_token) {
        return tokenData.access_token;
    } else {
        throw new Error('Error obteniendo token OAuth2: ' + tokenResponse.getContentText());
    }
}

/**
 * Helper para respuestas JSON
 */
function jsonResponse(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj))
        .setMimeType(ContentService.MimeType.JSON);
}
