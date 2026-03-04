# Reglas del Proyecto EmerCRE

## Versionado de la Aplicación
El formato de las versiones de la aplicación seguirá la estructura **V.x.y.z**, donde cada letra representa un nivel de cambio:

- **z (Corrección de errores):** Se incrementa este número exclusivamente cuando el cambio realizado sea para arreglar algo que no funcionaba correctamente (bug fixes, fallos de visualización, etc.).
- **y (Nuevas capacidades):** Se incrementa este número cuando el cambio introduzca una nueva funcionalidad o capacidad a la aplicación (nuevos botones, nuevas pantallas, lógica adicional).
- **x (Cambios mayores):** Se incrementa este número cuando se haga un cambio muy grande, una reestructuración completa o un salto evolutivo en la aplicación.

*Nota: Cuando se incrementa un nivel superior, los niveles inferiores se reinician a 0. Por ejemplo, al pasar de V.1.2.5 añadiendo una nueva capacidad, la versión pasaría a ser V.1.3.0.*

### Regla Obligatoria
- **SIEMPRE que se realice una modificación en la aplicación (ya sea para corregir algo, añadir una mejora o restructurar), el desarrollador/asistente debe incrementar la versión correspondientemente según las reglas arriba citadas, editar explícitamente el archivo `index.html` (o donde proceda) para que el número de versión visual cambie y el usuario pueda verlo reflejado en la pantalla, y finalmente subir los cambios al repositorio de GitHub utilizando el script `push.ps1` o similar.**

## Seguridad y Privacidad
- **PROHIBICIÓN ESTRICTA**: No se debe subir NUNCA el archivo `firestore.rules` al repositorio de GitHub ni a ningún otro almacenamiento público. Este archivo contiene las reglas de seguridad de la base de datos y debe permanecer únicamente en el equipo local y en la consola de Firebase.
- Al usar scripts de sincronización (como `push.ps1` o `sync_all.ps1`), se debe verificar que `firestore.rules` esté excluido de la lista de archivos a subir.

## Gestión del Repositorio GitHub

El repositorio `juliopuli/emercre` sirve la aplicación vía **GitHub Pages**. Solo deben estar los archivos que el navegador necesita descargar para ejecutar la app.

### Lista Blanca de Archivos Permitidos

| Archivo / Ruta | Motivo |
|---|---|
| `index.html` | La aplicación web en sí |
| `manifest.json` | Metadatos del PWA |
| `firebase-messaging-sw.js` | Service Worker de Firebase para push; debe estar en la raíz del dominio |
| `assets/logo_emercre.png` | Logo usado en la app y en las notificaciones push |
| `assets/favicon.ico` | Icono del navegador |
| `assets/alert.mp3` | Sonido de alerta reproducido por la app |
| `assets/icons/*.png` / `*.svg` | Iconos para marcadores del mapa |
| `.github/workflows/deploy.yml` | Workflow de despliegue automático de GitHub Actions |

### Archivos PROHIBIDOS en el Repositorio

Los siguientes tipos de archivos **nunca** deben subirse al repositorio:

- **Scripts de servidor**: Cualquier archivo que se ejecute en un servidor externo (Google Apps Script, Cloud Functions, etc.), como `gas_push_bridge.js`. Estos no son servidos por GitHub Pages y no deben estar en el repo.
- **Archivos con credenciales o claves privadas**: Claves de Service Account, tokens de API, private keys RSA, etc. (aunque estén en archivos `.js` y no en `.json`).
- **Archivos de desarrollo local**: Scripts de utilidad (`.ps1`, `.sh`, `.py`), archivos de pruebas, volcados de datos (`.json` de dumps), documentos (`.docx`), etc.
- **Versiones antiguas del HTML**: Archivos como `index_raw.html`, `github_index.html`, `index_1a288e9.html`, etc.

### Regla Obligatoria
Antes de subir cualquier archivo al repositorio, el desarrollador/asistente debe verificar que dicho archivo figure en la Lista Blanca anterior. En caso de duda, el archivo **NO se sube**.

