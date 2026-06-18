# Design: Informe Semanal de Hotmail

## 1. Vision general

Arquitectura de tuberia (pipeline) de 14 pasos ejecutada semanalmente en GitHub Actions. Un script orquestador (`build-digest.mjs`) coordina la secuencia: adquiere un token MSAL desde un cache serializado, consulta Microsoft Graph API por correos no leidos de los ultimos 7 dias, filtra contra un checkpoint local, construye un reporte HTML multipart/alternative, lo envia via Gmail API OAuth2, marca como leidos los mensajes reportados usando `$batch`, persiste el checkpoint actualizado con `[skip ci]`, y rotael cache MSAL. Cada etapa tiene politica de reintentos explicita y manejo de errores que, ante fallo no recuperable, envia un correo de error al mismo destino Gmail.

```
 GH Actions (cron, ubuntu-latest)
 ┌────────────────────────────────────────────────────────────┐
 │  1. Inicializar entorno                                     │
 │  2. Validar 6 secretos                                      │
 │  3. Cargar cache MSAL → refrescar token                    │
 │  4. Leer checkpoint (state/reported-ids.json)               │
 │  5. GET /me/mailFolders/inbox/messages (paginado, ≤500)     │
 │  6. Filtrar contra checkpoint                               │
 │  7. Si vacio → exit 0 sin efectos                           │
 │  8. Construir reporte HTML + plain text                     │
 │  9. Enviar a Gmail via Gmail API (reintento 2)              │
 │ 10. PATCH isRead=true en batches de 20 (reintento 2)        │
 │ 11. Escribir checkpoint local                               │
 │ 12. git add + commit + push [skip ci]                       │
 │ 13. gh secret set MSAL_TOKEN_CACHE_JSON (rotacion)          │
 │ 14. Log final                                               │
 └──────────┬─────────────────────────────────────┬───────────┘
            │                                     │
            ▼                                     ▼
   Microsoft Graph API (consumers)     Gmail API + OAuth2
   GET /me/mailFolders/inbox/messages  users.me.messages.send
   PATCH /me/messages/{id}
            │                                     │
            ▼                                     ▼
   state/reported-ids.json              GMAIL_DESTINATION_ADDRESS
   (checkpoint, commit con [skip ci])   (reporte HTML)
```

## 2. Componentes

### 2.1 `.github/workflows/weekly-digest.yml`

**Responsabilidad**: Orquestar la ejecucion completa. Cron `0 13 * * 1` + `workflow_dispatch`. Define jobs, pasos, secretos como env vars.

**Interfaz**: No exporta funciones. Archivo YAML con jobs:
- `validate`: verifica secretos presentes
- `digest`: ejecuta `build-digest.mjs` con los secretos como env

**Dependencias**: Todos los scripts `.mjs`. `GITHUB_TOKEN` para commit/push. `gh` CLI para `gh secret set`.

**Modelo de error**: Si `validate` falla → job fallido, logs en Actions. Si `digest` falla → `build-digest.mjs` maneja el error internamente y envia correo de error antes de salir con codigo != 0.

### 2.2 `scripts/lib/msal.mjs`

**Responsabilidad**: Inicializar MSAL Node, cargar cache serializado, adquirir token silenciosamente, devolver token de acceso.

**Interfaz**:
```js
/**
 * Carga el cache MSAL desde una variable de entorno JSON.
 * @param {string} tokenCacheJson - JSON string del cache MSAL (de MSAL_TOKEN_CACHE_JSON)
 * @returns {Promise<{accessToken: string, account: IAccount, tokenCache: string}>}
 * @throws {MSAL_INIT_ERROR} Si el JSON es invalido o no hay cuentas
 * @throws {MSAL_AUTH_ERROR} Si acquireTokenSilent falla sin renovacion posible
 */
export async function loadAndAcquireToken(tokenCacheJson)

/**
 * Serializa el cache actualizado de vuelta a JSON string.
 * @param {TokenCache} tokenCache - Instancia del cache MSAL post-ejecucion
 * @returns {string} JSON string del cache actualizado
 */
export function serializeCache(tokenCache)

/**
 * Crea la configuracion de MSAL para tenant consumers.
 * @returns {{auth: MsalAuthConfig, system: MsalSystemConfig}}
 */
export function createMsalConfig()
```

**Dependencias**: `@azure/msal-node` (npm). No depende de otros modulos locales.

**Modelo de error**:
- `MSAL_INIT_ERROR`: JSON invalido, no hay cuentas → aborta (no recuperable)
- `MSAL_AUTH_ERROR`: Token expirado sin renovacion → aborta (no recuperable)
- Rotacion: el cache se actualiza internamente por MSAL; la serializacion post-run captura el nuevo refresh token

### 2.3 `scripts/build-digest.mjs`

**Responsabilidad**: Script principal. Orquesta toda la secuencia. Punto de entrada del workflow.

**Interfaz**:
```js
/**
 * @param {object} opts
 * @param {string} opts.hotmailAddress - De HOTMAIL_ACCOUNT_ADDRESS
 * @param {string} opts.msalTokenCacheJson - De MSAL_TOKEN_CACHE_JSON
 * @param {string} opts.gmailClientId - De GMAIL_OAUTH_CLIENT_ID
 * @param {string} opts.gmailClientSecret - De GMAIL_OAUTH_CLIENT_SECRET
 * @param {string} opts.gmailRefreshToken - De GMAIL_OAUTH_REFRESH_TOKEN
 * @param {string} opts.gmailDestination - De GMAIL_DESTINATION_ADDRESS
 * @param {boolean} opts.dryRun - Si es true, no envia ni marca como leido
 * @returns {Promise<{exitCode: number, reportedIds: string[], updatedTokenCache: string|null}>}
 */
async function main(opts)
```

**Dependencias**: `msal.mjs`, `gmail.mjs`, `send-gmail.mjs`, `mark-read.mjs`, `error-report.mjs`, `checkpoint.mjs`. Tambien `report/templates.mjs` para las plantillas.

**Modelo de error**: Centraliza todo el manejo de errores. Cada etapa tiene try/catch. Si alguna etapa falla:
- Etapas 1-6 (adquisicion): aborta sin efectos secundarios
- Etapa 7 (reporte vacio): exit 0 normal
- Etapas 8-9 (construccion/envio): aborta, NO marca como leido, NO escribe checkpoint. Envia correo de error.
- Etapas 10-12 (mark-read + checkpoint + commit): si falla mark-read parcialmente, checkpoint NO se actualiza. Error report envia lista de IDs fallidos.

### 2.4 `scripts/send-gmail.mjs`

**Responsabilidad**: Enviar el reporte HTML como correo multipart/alternative via Gmail API.

**Interfaz**:
```js
/**
 * Envia un correo via Gmail API usando OAuth2.
 * @param {object} opts
 * @param {string} opts.clientId
 * @param {string} opts.clientSecret
 * @param {string} opts.refreshToken
 * @param {string} opts.from - Direccion origen (GMAIL_DESTINATION_ADDRESS)
 * @param {string} opts.to - Destinatario (GMAIL_DESTINATION_ADDRESS)
 * @param {string} opts.subject - Asunto del correo
 * @param {string} opts.htmlBody - Cuerpo HTML
 * @param {string} opts.textBody - Cuerpo texto plano
 * @param {number} [opts.retryCount=2] - Intentos de reintento
 * @returns {Promise<{messageId: string}>}
 * @throws {GMAIL_AUTH_ERROR} Si el refresh token es invalido
 * @throws {GMAIL_SEND_ERROR} Si falla el envio tras reintentos
 */
export async function sendGmail(opts)
```

**Dependencias**: `googleapis` (npm). `lib/gmail.mjs` para inicializar cliente OAuth2.

**Modelo de error**:
- `GMAIL_CONFIG_ERROR`: secreto faltante → aborta sin reintento
- `GMAIL_AUTH_ERROR`: refresh token revocado → aborta sin reintento
- `GMAIL_SEND_ERROR`: error HTTP 5xx/429 → reintenta hasta 2 veces con backoff 2s/8s

### 2.5 `scripts/mark-read.mjs`

**Responsabilidad**: Marcar como leidos los mensajes reportados usando Graph API `$batch`.

**Interfaz**:
```js
/**
 * Marca una lista de mensajes como leidos usando Graph batch API.
 * @param {string} accessToken - Token de acceso MSAL
 * @param {string[]} messageIds - IDs de mensajes a marcar
 * @param {number} [batchSize=20] - Tamanio del batch
 * @param {number} [retryCount=2] - Reintentos por batch fallido
 * @returns {Promise<{succeeded: string[], failed: string[]}>}
 */
export async function markAsRead(accessToken, messageIds, batchSize = 20, retryCount = 2)
```

**Dependencias**: `msal.mjs` (solo para el token). HTTP nativo (`fetch` o `https`).

**Modelo de error**: Fallo parcial no bloquea el resto. Retorna listas separadas de exitosos y fallidos. Si TODOS fallan tras reintentos, se considera error de etapa.

### 2.6 `scripts/error-report.mjs`

**Responsabilidad**: Construir y enviar correo de error cuando el pipeline falla.

**Interfaz**:
```js
/**
 * Envia un correo de error al Gmail destino.
 * @param {object} opts
 * @param {string} opts.stage - Etapa donde fallo (acquisition|checkpoint|report|send|mark-read)
 * @param {string} opts.errorMessage - Mensaje de error
 * @param {string} opts.errorStack - Stack trace (se trunca a 2KB)
 * @param {string} opts.runId - GitHub Actions Run ID
 * @param {string} opts.runUrl - URL de la ejecucion
 * @param {object} opts.gmailCreds - Credenciales Gmail para enviar el error
 * @returns {Promise<void>}
 */
export async function sendErrorReport(opts)
```

**Dependencias**: `send-gmail.mjs`. No depende de `msal.mjs` (usa Gmail para notificar, no Hotmail).

**Modelo de error**: Si el propio correo de error falla, se registra en stdout/stderr para que los logs de GH Actions lo capturen. No hay reintento para el error report.

### 2.7 `scripts/checkpoint.mjs`

**Responsabilidad**: Leer, filtrar y escribir el archivo de checkpoint.

**Interfaz**:
```js
/**
 * Lee el checkpoint desde state/reported-ids.json.
 * @returns {Promise<{version: number, lastRunAt: string|null, reportedIds: Array<{id: string, reportedAt: string}>}>}
 */
export async function readCheckpoint()

/**
 * Filtra mensajes excluyendo los que ya estan en el checkpoint.
 * @param {Array<{id: string}>} messages - Mensajes desde Graph
 * @param {Set<string>} reportedIds - IDs ya reportados
 * @returns {Array<{id: string}>} Mensajes nuevos (no reportados)
 */
export function filterNewMessages(messages, reportedIds)

/**
 * Escribe el checkpoint actualizado.
 * @param {string[]} newIds - IDs recien reportados
 * @param {string} lastRunAt - Timestamp ISO de la ejecucion
 * @returns {Promise<void>}
 */
export async function writeCheckpoint(newIds, lastRunAt)
```

**Dependencias**: `fs/promises` de Node.js. Ruta `state/reported-ids.json`.

**Modelo de error**: Si `readCheckpoint` falla (archivo corrupto), se crea uno nuevo (comportamiento tolerante). Si `writeCheckpoint` falla, el pipeline aborta (no se puede garantizar idempotencia).

### 2.8 `scripts/lib/gmail.mjs`

**Responsabilidad**: Inicializar y exponer el cliente Gmail API autenticado.

**Interfaz**:
```js
/**
 * Crea un cliente de Gmail API autenticado con OAuth2.
 * @param {string} clientId
 * @param {string} clientSecret
 * @param {string} refreshToken
 * @returns {Promise<gmail_v1.Gmail>}
 * @throws {GMAIL_CONFIG_ERROR} Si faltan credenciales
 */
export async function createGmailClient(clientId, clientSecret, refreshToken)
```

**Dependencias**: `googleapis` (npm).

### 2.9 Plantillas de reporte (`scripts/report/templates.mjs`)

**Responsabilidad**: Proveer funciones de construccion de HTML y texto plano.

**Interfaz**:
```js
/**
 * Construye el HTML completo del reporte.
 * @param {object} data
 * @param {string} data.hotmailAddress - Cuenta origen
 * @param {string} data.dateRange - Rango de fechas en COL
 * @param {number} data.totalMessages - Total de correos
 * @param {number} data.focusedCount - Prioritarios
 * @param {number} data.otherCount - Otros
 * @param {Array<{date: string, sender: string, senderEmail: string, subject: string, receivedAt: string, importance: string, hasAttachments: boolean, classification: string, bodyPreview: string, id: string}>} data.messages - Agrupados por fecha y remitente
 * @returns {{html: string, text: string}}
 */
export function buildReport(data)

/**
 * Construye el HTML del correo de error.
 * @param {object} data
 * @param {string} data.stage
 * @param {string} data.errorMessage
 * @param {string} data.errorStack - Truncado a 2KB
 * @param {string} data.runId
 * @param {string} data.runUrl
 * @returns {{html: string, text: string}}
 */
export function buildErrorReport(data)
```

**Dependencias**: Ninguna (plantillas puras, sin npm).

### 2.10 `scripts/lib/alerts.mjs`

**Responsabilidad**: Detectar correos de alerta de seguridad segun tres criterios independientes (dominio del remitente, palabras clave en asunto, importancia alta) combinados con OR.

**Interfaz**:
```js
/**
 * Evalua si un mensaje es una alerta de seguridad.
 * @param {object} message - Mensaje de Graph API
 * @param {object} config
 * @param {string[]} config.securityDomains - Lista de dominios de seguridad
 * @param {string[]} config.securityKeywords - Lista de palabras clave en asunto
 * @returns {{isAlert: boolean, matchedCriteria: string[]}}
 */
export function detectAlert(message, config)

/**
 * Retorna la lista por defecto de dominios de seguridad (hardcoded).
 * @returns {string[]}
 */
export function getDefaultSecurityDomains()

/**
 * Retorna la lista por defecto de palabras clave de seguridad (bilingue EN/ES).
 * @returns {string[]}
 */
export function getDefaultSecurityKeywords()
```

**Dependencias**: Ninguna. No depende de otros modulos locales ni de npm.

**Modelo de error**: No aplica (funciones puras sin efectos secundarios, operacion en memoria).

## 3. Flujo end-to-end

### Paso 1: Inicializacion del workflow
- GH Actions activa el job `digest` en `ubuntu-latest`
- Clona el repositorio (incluyendo `state/reported-ids.json` del ultimo commit)
- `actions/setup-node` con Node.js 20+
- `npm install` (instala `@azure/msal-node`, `googleapis`)
- **Fallo**: Si `npm install` falla → Workflow se marca como fallido. No se envia correo de error (aun no tenemos los scripts cargados).

### Paso 2: Validacion de entorno
- Script verifica que los 6 secretos existen como env vars
- Verifica que `state/reported-ids.json` existe (si no, lo crea vacio)
- **Fallo**: Si falta un secreto → `process.exit(1)` con mensaje claro. No hay correo de error (no tenemos credenciales Gmail para enviarlo). Queda en logs de Actions.

### Paso 3: Carga y refresco del cache MSAL
- `msal.mjs:loadAndAcquireToken()` deserializa `MSAL_TOKEN_CACHE_JSON`
- Inicializa `msal.ConfidentialClientApplication` con tenant `consumers`
- Llama `acquireTokenSilent()` con scopes `["Mail.Read", "Mail.ReadWrite", "offline_access"]`
- **Fallo**: `MSAL_INIT_ERROR` o `MSAL_AUTH_ERROR` → aborta. Se envia correo de error via Gmail (las credenciales Gmail ya estan validadas en paso 2).

### Paso 4: Lectura de checkpoint
- `checkpoint.mjs:readCheckpoint()` lee `state/reported-ids.json`
- Si no existe o esta corrupto, crea `{version: 1, lastRunAt: null, reportedIds: []}`
- Extrae `Set<string>` de IDs reportados
- **Fallo**: Archivo corrupto no es fatal (se recrea). Error de permisos de lectura si es fatal → aborta.

### Paso 5: Query a Graph (con reintentos)
- Construye filtro: `receivedDateTime ge ${sevenDaysAgo.toISOString()}`
- `$select`: `id,subject,sender,from,receivedDateTime,isRead,hasAttachments,importance,inferenceClassification,bodyPreview,toRecipients`
- `$top`: 50
- Sigue `@odata.nextLink` hasta agotar resultados o alcanzar 500 mensajes
- **Politica de reintentos**: 3 intentos, backoff exponencial 1s/4s/16s para errores 429 (rate limit) y 5xx (servidor)
- Errores 401/403 no se reintentan (auth fallo, no recuperable)
- **Fallo**: Si tras 3 intentos falla → `GRAPH_CONNECTION_ERROR`. Se envia correo de error. No hay checkpoint, no hay mark-read.

### Paso 6: Filtro contra checkpoint
- `checkpoint.mjs:filterNewMessages()` elimina mensajes cuyo `id` esta en `reportedIds`
- Resultado: lista de mensajes nuevos
- **Fallo**: No aplica (operacion en memoria, no falla).

### Paso 6.5: Computo de alertas por mensaje
- `alerts.mjs:detectAlert()` se ejecuta sobre cada mensaje nuevo
- Tres funciones de deteccion independientes:
  - `matchSenderDomain(message, securityDomains)`: compara el dominio del remitente contra lista de dominios de seguridad conocidos
  - `matchSubjectKeywords(message, securityKeywords)`: busca palabras clave en el asunto (case-insensitive, substring match)
  - `matchHighImportance(message)`: verifica que `importance === "high"`
- Si alguna funcion retorna `true`, el mensaje se marca como alerta (`isAlert: true`)
- Cada alerta incluye `matchedCriteria: string[]` con los nombres de los criterios que activo
- Los mensajes SIN alertas reciben `isAlert: false` y `matchedCriteria: []`
- **Fallo**: No aplica (operacion en memoria, no falla).

### Paso 7: Si no hay mensajes nuevos → exit 0
- Log: "No se encontraron correos nuevos en los ultimos 7 dias."
- `process.exit(0)` sin efectos secundarios
- No se envia reporte, no se marcan mensajes, no se actualiza checkpoint
- **Nota**: El cache MSAL aun asi se rotaria si hubiera cambiado (paso 13), pero como no hay ejecucion de scripts post-run en este caso, se omite.

### Paso 8: Construccion del reporte
- `buildReport()` recibe los mensajes y genera HTML + texto plano
- Agrupa por fecha descendente, dentro de cada fecha por remitente alfabetico
- bodyPreview truncado a 240 caracteres
- **Fallo**: Error en construccion (bug) → `REPORT_CONSTRUCTION_ERROR`. Aborta, no envia, no marca. Correo de error.

### Paso 9: Envio a Gmail (con reintentos)
- `sendGmail()` con asunto `Reporte semanal Hotmail — {DD MMM YYYY}` en COL
- 2 intentos con backoff 2s/8s
- **Fallo**: Si tras 2 intentos falla → `GMAIL_SEND_ERROR`. Aborta. NO marca como leido. NO escribe checkpoint. Correo de error enviado (ironicamente, el correo de error usa las mismas credenciales Gmail; si el fallo es de autenticacion, el error report tambien fallara y solo quedan logs de Actions).

### Paso 10: Marcado como leido (batch + reintentos)
- `markAsRead()` divide los IDs en batches de 20
- Cada batch: POST a `$batch` con hasta 20 requests `PATCH /me/messages/{id}`
- 2 reintentos por batch fallido
- Fallo parcial: IDs exitosos y fallidos se registran por separado
- **Fallo total**: Si todos los batches fallan → error de etapa. Correo de error incluye lista completa de IDs que no se pudieron marcar. Checkpoint NO se actualiza.
- **Fallo parcial**: Se registran los fallidos. El checkpoint se actualiza SOLO con los IDs marcados exitosamente. Esto es deliberado: los IDs fallidos se reintentaran en la proxima ejecucion.

### Paso 11: Escritura de checkpoint local
- `checkpoint.mjs:writeCheckpoint()` anade los nuevos IDs marcados exitosamente a `state/reported-ids.json`
- **Fallo**: Si la escritura falla → error de etapa. Correo de error. No se hace commit.

### Paso 12: Git commit + push con [skip ci]
- `git add state/reported-ids.json`
- `git commit -m "checkpoint: N nuevos mensajes [skip ci]"`
- `git push`
- **Fallo**: Si el push falla por conflicto (ejecucion concurrente, aunque no esperada) → error de etapa. Correo de error. El checkpoint local queda actualizado pero no persiste en el remoto. Proxima ejecucion usara el checkpoint anterior.

### Paso 13: Rotacion del cache MSAL
- `msal.mjs:serializeCache()` obtiene el cache actualizado
- `gh secret set MSAL_TOKEN_CACHE_JSON --body="$updatedCache" --repo=$REPO`
- **Fallo**: Si `gh secret set` falla → **warning log, NO aborta**. El workflow continua con exito. El usuario debe regenerar manualmente si el token expira. Se documenta en README.

### Paso 14: Log final
- "Reporte semanal completado exitosamente. N mensajes procesados."
- `process.exit(0)`

## 4. Diagrama de secuencia

```
GH Action              MSAL              Graph API              Gmail API              Repo
    │                    │                  │                      │                    │
    │-- cron/trigger     │                  │                      │                    │
    │                    │                  │                      │                    │
    │-- validar env     │                  │                      │                    │
    │                    │                  │                      │                    │
    │-- loadAndAcquire-->│                  │                      │                    │
    │                    │-- refresh token  │                      │                    │
    │<-- accessToken ----│                  │                      │                    │
    │                    │                  │                      │                    │
    │-- readCheckpoint   │                  │                      │                    │
    │<-- reportedIds     │                  │                      │                    │
    │                    │                  │                      │                    │
    │-- GET inbox msgs --│----------------->│                      │                    │
    │<-- messages[] ----│------------------│                      │                    │
    │                    │                  │                      │                    │
    │-- filterNewMessages(msgs, reported)   │                      │                    │
    │                    │                  │                      │                    │
    │-- detectAlert() per message           │                      │                    │
    │                    │                  │                      │                    │
    │-- buildReport()    │                  │                      │                    │
    │                    │                  │                      │                    │
    │-- sendGmail() -----│------------------│--------------------->│                    │
    │<-- messageId ------│------------------│----------------------│                    │
    │                    │                  │                      │                    │
    │-- markAsRead()     │                  │                      │                    │
    │    PATCH batch 1  -│----------------->│                      │                    │
    │<-- 200 OK ---------│------------------│                      │                    │
    │    PATCH batch 2  -│----------------->│                      │                    │
    │<-- 200 OK ---------│------------------│                      │                    │
    │                    │                  │                      │                    │
    │-- writeCheckpoint  │                  │                      │                    │
    │-- git commit+push  │                  │                      │                  -->│
    │                    │                  │                      │                    │
    │-- gh secret set    │                  │                      │                    │
    │   (token cache)    │                  │                      │                    │
```


**Nota**: El computo de alertas (`detectAlert()`) ocurre entre el filtro contra checkpoint y la construccion del reporte. No involucra llamadas a ninguna API externa; es operacion en memoria sobre los datos ya obtenidos de Graph. No hay nueva linea en el diagrama de secuencia porque la operacion es local al script orquestador.

**Escenario de fallo: Gmail send failure**

```
GH Action              MSAL              Graph API              Gmail API              Repo
    │                    │                  │                      │                    │
    │ (pasos 1-8 OK)     │                  │                      │                    │
    │                    │                  │                      │                    │
    │-- sendGmail() -----│------------------│--------------------->│                    │
    │                    │                  │                      │  (error 500)       │
    │-- reintento 1 -----│------------------│--------------------->│                    │
    │                    │                  │                      │  (error 500)       │
    │-- reintento 2 -----│------------------│--------------------->│                    │
    │                    │                  │                      │  (error 500)       │
    │                    │                  │                      │                    │
    │-- sendErrorReport  │                  │                      │                    │
    │-- process.exit(1)  │                  │                      │                    │
    │                    │                  │                      │                    │
    │ (NO mark-read)     │                  │                      │                    │
    │ (NO checkpoint)    │                  │                      │                    │
    │ (NO commit)        │                  │                      │                    │
```

## 5. Estructura de archivos concreta

```
mcp/
├── .github/
│   └── workflows/
│       └── weekly-digest.yml           # Cron + workflow_dispatch (~60 lines). Deps: todos los scripts.
│
├── scripts/
│   ├── build-digest.mjs                # Orquestador principal (~200 lines). Deps: todos los modulos.
│   ├── send-gmail.mjs                  # Envio Gmail API (~80 lines). Deps: lib/gmail.mjs, googleapis.
│   ├── mark-read.mjs                   # Batch PATCH isRead=true (~100 lines). Deps: fetch nativo.
│   ├── error-report.mjs                # Correo de error (~60 lines). Deps: send-gmail.mjs.
│   ├── checkpoint.mjs                  # Checkpoint state/reported-ids.json (~80 lines). Deps: fs/promises.
│   ├── lib/
│   │   ├── msal.mjs                    # MSAL Node init + token acquisition (~100 lines). Deps: @azure/msal-node.
│   │   └── gmail.mjs                   # Cliente Gmail OAuth2 (~40 lines). Deps: googleapis.
│   └── report/
│       └── templates.mjs               # Plantillas HTML + texto (~150 lines). Deps: ninguna.
│
├── .env.example                        # Template de variables de entorno (~10 lines)
├── .gitignore                          # .env, node_modules, state/reported-ids.json (local), .local/
├── package.json                        # type: module + scripts dev:once / dev:dry (~15 lines)
├── state/
│   └── reported-ids.json               # Checkpoint (generado, versionado en GH)
├── README.md                           # Setup, uso local, despliegue (~80 lines)
└── openspec/
    └── changes/
        └── informe-semanal-hotmail/
            ├── proposal.md
            ├── specs/ (8 dominios)
            ├── design.md               ← Este archivo
            └── tasks.md                (proxima fase)
```

**Estimacion total del cambio**: ~800 lineas de codigo nuevo (scripts) + ~60 lineas YAML + ~80 lineas README + ~15 lineas package.json.

## 6. Plantillas de correo

### 6.1 Plantilla de reporte

Estructura HTML completa con CSS inline (Gmail elimina `<style>`). Max-width 720px, sistema de fuentes nativo del sistema, tabla responsiva. Los valores entre `{{ }}` son placeholders que `buildReport()` reemplaza.

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
</head>
<body style="margin:0;padding:0;background-color:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,Cantarell,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f8;">
<tr><td align="center" style="padding:20px 10px;">
<table role="presentation" width="100%" style="max-width:720px;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

<!-- Encabezado -->
<tr><td style="background-color:#1a73e8;padding:24px 32px;">
<h1 style="margin:0;font-size:20px;font-weight:600;color:#ffffff;">Reporte semanal Hotmail</h1>
<p style="margin:8px 0 0;font-size:14px;color:#ffffffcc;">
Cuenta: {{hotmailAddress}} &middot; Periodo: {{dateRange}}
</p>
</td></tr>

<!-- Resumen -->
<tr><td style="padding:24px 32px;border-bottom:1px solid #e0e0e0;">
<table role="presentation" width="100%">
<tr>
<td style="text-align:center;padding:8px;">
<div style="font-size:28px;font-weight:700;color:#1a73e8;">{{totalMessages}}</div>
<div style="font-size:12px;color:#666;">Total no leidos</div>
</td>
<td style="text-align:center;padding:8px;">
<div style="font-size:28px;font-weight:700;color:#34a853;">{{focusedCount}}</div>
<div style="font-size:12px;color:#666;">Prioritarios</div>
</td>
<td style="text-align:center;padding:8px;">
<div style="font-size:28px;font-weight:700;color:#ea4335;">{{otherCount}}</div>
<div style="font-size:12px;color:#666;">Otros</div>
</td>
</tr>
</table>
</td></tr>

<!-- Banner de alertas de seguridad (condicional) -->
{{alertBanner}}

<!-- Acciones requeridas (condicional) -->
{{alertActionSection}}

<!-- Mensajes agrupados por fecha -->
{{dateSections}}

<!-- Pie de pagina -->
<tr><td style="padding:16px 32px;background-color:#f8f9fa;border-top:1px solid #e0e0e0;">
<p style="margin:0;font-size:11px;color:#999;font-family:Consolas,monospace;">
IDs procesados: {{reportedIds}}
</p>
<p style="margin:8px 0 0;font-size:11px;color:#999;">
Generado el {{generatedAt}} &middot; <a href="{{runUrl}}" style="color:#1a73e8;">Ver ejecucion</a>
</p>
</td></tr>

</table>
</td></tr></table>
</body>
</html>
```

**Bloque de seccion por fecha** (insertado dinamicamente en `{{dateSections}}`):

```html
<tr><td style="padding:16px 32px 8px;">
<h2 style="margin:0;font-size:16px;font-weight:600;color:#333;">{{dateLabel}}</h2>
</td></tr>
<tr><td style="padding:0 32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
{{messageRows}}
</table>
</td></tr>
```

**Fila de mensaje** (insertada en `{{messageRows}}`):

```html
<tr>
<td style="padding:10px 0;border-bottom:1px solid #f0f0f0;">
<div style="font-size:13px;font-weight:600;color:#333;">
<a href="mailto:{{senderEmail}}" style="color:#1a73e8;text-decoration:none;">{{senderName}}</a>
{{importanceBadge}} {{attachmentBadge}} {{classificationLabel}}
</div>
<div style="font-size:14px;color:#111;margin:4px 0;">
<strong>{{subject}}</strong>
</div>
<div style="font-size:12px;color:#666;">
{{receivedAtCOL}}
</div>
<div style="font-size:12px;color:#555;margin:6px 0;line-height:1.4;">
{{bodyPreviewTruncated}}...
<a href="https://outlook.live.com/mail/0/inbox/id/{{messageId}}" style="color:#1a73e8;text-decoration:none;">Abrir en Hotmail</a>
</div>
</td>
</tr>
```

**Badges**:
- Importancia alta: `<span style="display:inline-block;font-size:11px;padding:1px 6px;border-radius:3px;background-color:#fce8e6;color:#c5221f;font-weight:500;margin-left:6px;">Alta</span>`
- Con adjunto: `<span style="display:inline-block;font-size:11px;padding:1px 6px;border-radius:3px;background-color:#e8f0fe;color:#1967d2;font-weight:500;margin-left:4px;">Adjunto</span>`
- Clasificacion: focused → `<span style="display:inline-block;font-size:11px;padding:1px 6px;border-radius:3px;background-color:#e6f4ea;color:#1e8e3e;font-weight:500;margin-left:4px;">Prioritario</span>`, other → `<span style="display:inline-block;font-size:11px;padding:1px 6px;border-radius:3px;background-color:#f1f3f4;color:#5f6368;font-weight:500;margin-left:4px;">Otros</span>`

**Asunto del correo**: `Reporte semanal Hotmail — {{DD MMM YYYY}}` (fecha en COL, e.g. `17 jun 2026`). Si hay una o mas alertas de seguridad, el asunto incluye el prefijo 🚨: `🚨 Reporte semanal Hotmail — {{DD MMM YYYY}}`.

**Texto plano** (parte `text/plain` del multipart/alternative):
```
Reporte semanal Hotmail
Cuenta: {{hotmailAddress}} | Periodo: {{dateRange}}

Total: {{totalMessages}} ({{focusedCount}} prioritarios, {{otherCount}} otros)

{{dateLabel}}
  {{senderName}} <{{senderEmail}}>
  Asunto: {{subject}}
  Fecha: {{receivedAtCOL}}
  {{bodyPreviewTruncated}}
  https://outlook.live.com/mail/0/inbox/id/{{messageId}}
```

### 6.2 Plantilla de banner de alertas

Insertado en `{{alertBanner}}`. Solo se incluye cuando `alertCount > 0`. El banner usa fondo rojo claro con borde rojo, justo debajo del resumen numerico.

```html
<tr><td style="padding:16px 32px;background-color:#fef2f2;border-bottom:2px solid #dc2626;">
<table role="presentation" width="100%">
<tr>
<td style="vertical-align:top;padding-right:12px;width:32px;font-size:24px;">⚠️</td>
<td>
<div style="font-size:15px;font-weight:600;color:#991b1b;">
⚠️ {{alertCount}} alerta(s) critica(s) detectada(s)
</div>
{{#if alertBullets}}
<ul style="margin:8px 0 0;padding:0 0 0 20px;font-size:13px;color:#7f1d1d;">
{{alertBullets}}
</ul>
{{/if}}
</td>
</tr>
</table>
</td></tr>
```

Cada viñeta en `{{alertBullets}}`:

```html
<li><a href="https://outlook.live.com/mail/0/inbox/id/{{messageId}}" style="color:#b91c1c;">{{subject}}</a> — {{senderName}}</li>
```

### 6.3 Plantilla de seccion "Acciones requeridas"

Insertado en `{{alertActionSection}}`. Solo se incluye cuando `alertCount > 0`. Se ubica entre el banner de alertas y las secciones de fecha.

```html
<tr><td style="padding:24px 32px;background-color:#fff7ed;border-bottom:1px solid #fed7aa;">
<h2 style="margin:0;font-size:16px;font-weight:600;color:#9a3412;">Acciones requeridas</h2>
<p style="margin:4px 0 16px;font-size:13px;color:#92400e;">
Los siguientes correos requieren atencion inmediata:
</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
{{alertDetailRows}}
</table>
</td></tr>
```

Cada fila de detalle en `{{alertDetailRows}}`:

```html
<tr>
<td style="padding:12px 0;border-bottom:1px solid #fef3c7;">
<div style="font-size:13px;font-weight:600;color:#333;">
<a href="mailto:{{senderEmail}}" style="color:#1a73e8;text-decoration:none;">{{senderName}}</a>
{{importanceBadge}}
</div>
<div style="font-size:14px;color:#111;margin:4px 0;">
<strong>{{subject}}</strong>
</div>
<div style="font-size:12px;color:#666;">
{{receivedAtCOL}}
</div>
<div style="font-size:12px;color:#555;margin:6px 0;line-height:1.4;white-space:pre-wrap;">
{{bodyPreviewFull}}
</div>
<div style="font-size:12px;margin:4px 0;">
<a href="https://outlook.live.com/mail/0/inbox/id/{{messageId}}" style="color:#b91c1c;font-weight:500;">Abrir en Hotmail →</a>
</div>
</td>
</tr>
```

Nota: `{{bodyPreviewFull}}` es el bodyPreview completo del mensaje, sin truncar. Solo las filas de "Acciones requeridas" usan bodyPreview completo; las filas de la seccion de fecha usan `{{bodyPreviewTruncated}}` (240 caracteres).

### 6.4 Plantilla de error

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
</head>
<body style="margin:0;padding:0;background-color:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,Cantarell,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f8;">
<tr><td align="center" style="padding:20px 10px;">
<table role="presentation" width="100%" style="max-width:600px;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

<tr><td style="background-color:#d93025;padding:20px 24px;">
<h1 style="margin:0;font-size:18px;font-weight:600;color:#ffffff;">ERROR: Reporte semanal Hotmail</h1>
</td></tr>

<tr><td style="padding:24px;">

<div style="margin-bottom:16px;">
<span style="display:inline-block;font-size:12px;padding:4px 12px;border-radius:4px;background-color:#fce8e6;color:#c5221f;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">{{stage}}</span>
</div>

<div style="font-size:14px;color:#333;margin-bottom:16px;font-family:Consolas,monospace;background-color:#f8f9fa;padding:12px;border-radius:4px;border-left:3px solid #d93025;">
{{errorMessage}}
</div>

<div style="font-size:12px;color:#666;margin-bottom:16px;font-family:Consolas,monospace;background-color:#f8f9fa;padding:12px;border-radius:4px;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow-y:auto;">
{{errorStack}}
</div>

<table role="presentation" style="font-size:13px;color:#333;">
<tr><td style="padding:4px 0;color:#666;">Run ID:</td><td style="padding:4px 8px;font-family:Consolas,monospace;">{{runId}}</td></tr>
<tr><td style="padding:4px 0;color:#666;">URL:</td><td style="padding:4px 8px;"><a href="{{runUrl}}" style="color:#1a73e8;">{{runUrl}}</a></td></tr>
</table>

</td></tr>
</table>
</td></tr></table>
</body>
</html>
```

**Asunto del correo de error**: `ERROR: Reporte semanal Hotmail — {{ISO timestamp}}`

## 7. Ciclo de vida del token cache

### 7.1 Generacion local

El token cache MSAL se genera localmente usando el MCP de Softeria:

```bash
# 1. Ejecutar el login con write scope (una sola vez)
npx @softeria/ms-365-mcp-server --preset outlook --tenant consumers

# 2. Completar el flujo device code en el navegador
#    Abrir https://microsoft.com/devicelogin e ingresar el codigo mostrado
#    Autenticar con la cuenta Hotmail personal

# 3. Exportar el cache
#    En sistemas Unix: ~/.local/share/softeria/ms-365-mcp-server/token-cache
#    En Windows: %APPDATA%/softeria/ms-365-mcp-server/token-cache

# 4. Convertir a JSON string y almacenar como GH secret
gh secret set MSAL_TOKEN_CACHE_JSON --repo <usuario>/mcp --body "$(cat ~/.local/share/softeria/ms-365-mcp-server/token-cache)"
```

### 7.2 Formato

El cache es un objeto JSON serializado por MSAL Node que contiene:
- `Account` (informacion de la cuenta autenticada)
- `AccessToken` (token de acceso vigente, expira ~60-90 min)
- `RefreshToken` (refresh token, "until-revoked" para MSA single-factor)
- `IdToken` (token de identidad)

Se almacena como string JSON en el secreto de GitHub `MSAL_TOKEN_CACHE_JSON`.

### 7.3 Carga en el workflow

```yaml
- name: Setup MSAL token cache
  run: |
    mkdir -p ~/.cache/msal
    echo '${{ secrets.MSAL_TOKEN_CACHE_JSON }}' > ~/.cache/msal/cache.json
  env:
    MSAL_TOKEN_CACHE_JSON: ${{ secrets.MSAL_TOKEN_CACHE_JSON }}
```

El script `msal.mjs` lee el archivo `~/.cache/msal/cache.json`, lo deserializa, y lo pasa a `msal.ConfidentialClientApplication` mediante `tokenCache.deserialize()`.

### 7.4 Rotacion post-ejecucion

MSAL Node rota el refresh token internamente durante `acquireTokenSilent()`. El cache actualizado debe persistirse:

```yaml
- name: Rotate MSAL token cache
  if: always()
  run: |
    UPDATED_CACHE=$(cat ~/.cache/msal/cache.json)
    echo "$UPDATED_CACHE" | gh secret set MSAL_TOKEN_CACHE_JSON --repo ${{ github.repository }}
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 7.5 Si la rotacion falla

El paso usa `if: always()` para ejecutarse incluso si el pipeline fallo (el cache pudo haberse refrescado parcialmente). Si `gh secret set` falla:
- Se registra un warning en los logs
- NO se aborta el workflow (exit code no cambia)
- El usuario debe regenerar manualmente el token usando las instrucciones en README si el workflow deja de funcionar por token expirado

## 8. Configuracion de secretos

### 8.1 `HOTMAIL_ACCOUNT_ADDRESS`

| Aspecto | Detalle |
|---------|---------|
| Que es | Direccion de correo Hotmail (MSA personal) |
| Como obtenerla | Es la direccion de la cuenta Hotmail del usuario |
| Donde vive localmente | `.env` |
| Como rotarla | Cambiar el valor en GH secrets y `.env` |
| Error si falta | `Falta secreto: HOTMAIL_ACCOUNT_ADDRESS` al inicio del script |

### 8.2 `MSAL_TOKEN_CACHE_JSON`

| Aspecto | Detalle |
|---------|---------|
| Que es | JSON serializado del cache MSAL (contiene refresh token, access token, account) |
| Como obtenerla | Ejecutar `npx @softeria/ms-365-mcp-server --preset outlook --tenant consumers`, completar device code, exportar archivo de cache |
| Donde vive localmente | Archivo en `~/.cache/msal/cache.json` (creado por el login) o directamente en `.env` como JSON string |
| Como rotarla | El workflow la rota automaticamente post-ejecucion via `gh secret set`. Rotacion manual: repetir el proceso de login local |
| Error si falta | `MSAL_INIT_ERROR: No se pudo deserializar el cache MSAL` |

### 8.3 `GMAIL_OAUTH_CLIENT_ID`

| Aspecto | Detalle |
|---------|---------|
| Que es | Client ID de OAuth 2.0 del proyecto Google Cloud |
| Como obtenerla | 1. Ir a https://console.cloud.google.com/ > Crear proyecto > APIs & Services > Credentials > Crear OAuth client ID > Desktop application > Copiar Client ID |
| Donde vive localmente | `.env` |
| Como rotarla | Regenerar credenciales en GCP Console |
| Error si falta | `GMAIL_CONFIG_ERROR: Falta GMAIL_OAUTH_CLIENT_ID` |

### 8.4 `GMAIL_OAUTH_CLIENT_SECRET`

| Aspecto | Detalle |
|---------|---------|
| Que es | Client Secret de OAuth 2.0 del proyecto Google Cloud |
| Como obtenerla | Mismo flujo que Client ID. Aparece junto al Client ID. Seleccion "Download JSON" y extraer `client_secret` |
| Donde vive localmente | `.env` |
| Como rotarla | Regenerar credenciales en GCP Console |
| Error si falta | `GMAIL_CONFIG_ERROR: Falta GMAIL_OAUTH_CLIENT_SECRET` |

### 8.5 `GMAIL_OAUTH_REFRESH_TOKEN`

| Aspecto | Detalle |
|---------|---------|
| Que es | Refresh token de Gmail OAuth2 con scope `gmail.send` y `access_type: offline` |
| Como obtenerla | 1. Tener Client ID y Client Secret listos. 2. Ejecutar flujo OAuth2 manual: abrir URL de autorizacion con `https://www.googleapis.com/auth/gmail.send` y `access_type=offline`. 3. Intercambiar `code` por `refresh_token`. Herramienta recomendada: `google-oauth2-token` npm package o Google OAuth Playground |
| Donde vive localmente | `.env` |
| Como rotarla | Repetir el flujo OAuth2. El refresh token se revoca si el usuario cambia la contrasenia de Gmail |
| Error si falta | `GMAIL_AUTH_ERROR: No se pudo renovar el access token. El refresh token puede estar revocado.` |

### 8.6 `GMAIL_DESTINATION_ADDRESS`

| Aspecto | Detalle |
|---------|---------|
| Que es | Direccion de correo Gmail donde se entrega el reporte |
| Como obtenerla | Es la direccion Gmail del usuario |
| Donde vive localmente | `.env` |
| Como rotarla | Cambiar el valor en GH secrets y `.env` |
| Error si falta | `GMAIL_CONFIG_ERROR: Falta GMAIL_DESTINATION_ADDRESS` |

## 9. Estrategia de pruebas (limitada)

El proyecto no tiene test runner. No se introduce uno nuevo.

### 9.1 Que NO cubren las pruebas automatizadas

- Unit tests de funciones individuales (no hay framework)
- Integration tests contra APIs reales (requieren credenciales)
- End-to-end completo automatizado (requiere GitHub Actions real)

### 9.2 Pasos de verificacion manual

**Fase 1: Dry run local**
```bash
# 1. Configurar .env con todos los secretos
# 2. Ejecutar dry run
npm run dev:dry
# 3. Verificar que .local/report-preview.html contiene el HTML correcto
# 4. Verificar que NO se envio correo (check Gmail)
# 5. Verificar que los mensajes NO se marcaron como leidos (check Hotmail)
```

**Fase 2: Ejecucion local completa**
```bash
# 1. Ejecutar con envio real
npm run dev:once
# 2. Verificar que el reporte llego al Gmail destino
# 3. Verificar que los correos aparecen como leidos en Hotmail
# 4. Verificar que el checkpoint local se actualizo
```

**Fase 3: workflow_dispatch en GH Actions**
```bash
# 1. Hacer push de la rama a GitHub
# 2. Ir a Actions > weekly-digest > Run workflow (branch: main)
# 3. Verificar en los logs que cada paso se ejecuta correctamente
# 4. Verificar el correo de reporte en Gmail
# 5. Verificar el commit con [skip ci] en el repositorio
```

**Fase 4: Prueba de idempotencia**
```bash
# 1. Ejecutar workflow_dispatch una vez (reporta X mensajes)
# 2. Ejecutar workflow_dispatch inmediatamente despues (segunda vez)
# 3. Verificar que el segundo run loguea "no new mail" y no envia reporte
```

**Fase 5: Prueba de fallo**
- Forzar un secreto invalido temporalmente
- Ejecutar workflow_dispatch
- Verificar que llega el correo de error al Gmail destino
- Verificar que el checkpoint NO se actualizo
- Restaurar el secreto

### 9.3 Limitaciones conocidas

- No se pueden probar rate limits sin alcanzarlos realmente
- No se puede probar la rotacion del token MSAL sin esperar 60+ min (expiración del access token)
- No se prueba la recuperacion ante caida de Graph API

## 10. Consideraciones operativas

### 10.1 Zona horaria

El cron `0 13 * * 1` ejecuta a las 13:00 UTC = 8:00 a.m. COL (UTC-5) sin horario de verano. Colombia no usa DST. Todas las fechas en el reporte se muestran en hora COL. El calculo de `receivedDateTime ge now - 7 dias` usa UTC internamente (Graph API opera en UTC), la conversion a COL se hace solo para visualizacion.

### 10.2 Rate limits

| API | Limite | Uso esperado | Margen |
|-----|--------|-------------|--------|
| Microsoft Graph | 10,000 requests / 10 min / user / app | ~50 GET + ~25 PATCH = ~75 requests | 133x por debajo |
| Gmail API | 250 quota units / user / second (1 send = 5 units) | 1 send + 1 error send = 10 units | 25x por debajo |

No se requiere logica adicional de throttling. La politica de reintentos cubre casos de rate limiting transitorio (429).

### 10.3 Regla de inactividad de 60 dias

GitHub Actions desactiva workflows programados en repositorios sin commits por 60+ dias. El commit semanal del checkpoint (`[skip ci]`) cuenta como actividad y evita la desactivacion. Si el workflow no encuentra correos durante varias semanas seguidas, no genera commit (paso 7: exit 0 sin checkpoint). En ese caso:
- El schedule se mantiene activo porque hay commits del checkpoint de semanas anteriores dentro de la ventana de 60 dias
- Si pasan mas de 60 dias sin correos, el usuario debe re-activar manualmente en Settings > Actions
- Solucion opcional (no implementada en este cambio): heartbeat bimensual

### 10.4 Tenant `consumers`

La cuenta Hotmail es personal (MSA), no corporativa. Usar tenant `consumers` en lugar de `common` o `organizational`. Esto evita errores 400/AADSTS50020 al autenticar cuentas personales contra el endpoint de organizaciones.

**Nota critica (junio 2026)**: Refresh tokens de MSA pueden ser rechazados si el tenant configurado es `common` y el token original se emitio con `consumers`. Siempre especificar `consumers` explicitamente.

## 11. Riesgos residuales

| Riesgo | Probabilidad | Impacto | Mitigacion en el diseno |
|--------|-------------|---------|------------------------|
| Token MSAL expira y rotation falla silenciosamente | Baja | Alto | Pasos 13-14: warning log + documentacion de rotacion manual en README. El workflow genera error report si falla la autenticacion. |
| Reporte contiene PII (bodyPreview con datos sensibles) | Media | Medio | bodyPreview truncado a 240 chars. El destino es el propio Gmail del usuario. Sin PII en el diseno mismo. |
| Checkpoint se corrompe (archivo JSON invalido) | Baja | Bajo | readCheckpoint crea checkpoint nuevo si el archivo esta corrupto. La ventana de 7 dias limita re-inclusion. |
| Rate limiting de Graph en batch de mark-read | Muy Baja | Bajo | Reintentos con backoff. 25 PATCH por ejecucion muy por debajo del limite. |
| Gmail refresh token revocado (cambio de password) | Baja | Medio | El error report se envia... pero usa las mismas credenciales Gmail. Si el token Gmail falla, solo quedan logs de Actions. Documentado en README. |
| Dos workflows se ejecutan en paralelo | Muy Baja | Medio | GH Actions no ejecuta el mismo workflow en paralelo por defecto. Se anade `concurrency: weekly-digest` como guarda adicional. |
| git push falla por conflicto | Baja | Bajo | Checkpoint local actualizado pero no remoto. Proxima ejecucion usa checkpoint anterior. Los mismos mensajes se reintentaran. |

**Nuevo riesgo surfaced en diseno**:
- **Dependencia de gh CLI**: El paso de rotacion del token MSAL usa `gh secret set`. Si `gh` no esta disponible o el token `GITHUB_TOKEN` no tiene permisos para leer/escribir secrets, la rotacion falla. Mitigacion: `if: always()` + warning log. El token `GITHUB_TOKEN` por defecto tiene permisos de secrets en el repositorio propio.

## 12. Decisiones tomadas en design

| Decision | Opcion | Justificacion |
|----------|--------|---------------|
| Batch size para mark-read | 20 | Limite de Graph batch es 20. Un batch por cada 20 mensajes. Sin paginacion interna de batch. |
| Reintentos Graph query | 3 intentos, backoff 1s/4s/16s | Suficiente para rate limits transitorios. Si 3 intentos fallan, es un problema persistente. |
| Reintentos Gmail send | 2 intentos, backoff 2s/8s | Gmail API es altamente disponible. 2 intentos cubren fallos transitorios. |
| Reintentos mark-read batch | 2 intentos por batch | Fallo parcial no bloquea el resto. 2 intentos cubren inconsistentcias transitorias. |
| Stack trace truncado | 2KB | Suficiente para diagnosticar sin saturar el correo de error. |
| Límite defensivo de paginacion | 500 mensajes | Una semana de correos no leidos raramente excede 100. 500 es seguro contra bucles infinitos. |
| Concurrency guard | `concurrency: weekly-digest` | Previene ejecucion paralela accidental del workflow. |
| Sistema de fuentes | `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif` | Stack nativo del sistema operativo. Sin descargas externas, compatible con Gmail. |
| Max-width del reporte | 720px | Legible en desktop y mobile sin romper el layout. |
| Formato de checkpoint | JSON con `version: 1` | Permite migraciones futuras cambiando el numero de version. |
| bodyPreview | Incluido, truncado a 240 caracteres | El usuario pidio "detalle completo". Privacidad mitigada: el reporte viaja solo al Gmail del usuario. |
| Enlace a Hotmail web | `https://outlook.live.com/mail/0/inbox/id/{id}` | Enlace directo al mensaje individual. ID de Graph es el mismo que el de Outlook Web. |
| `concurrency` en workflow | `group: weekly-digest` | Previene overlap entre cron y workflow_dispatch manual. |
| Listas de deteccion de alertas | Hardcoded en `scripts/lib/alerts.mjs` como constantes exportadas | Sin archivo de configuracion externo. Las listas de dominios y palabras clave cambian con poca frecuencia y no requieren edicion por parte del usuario. Hardcoded evita gestionar un archivo adicional y posible error por archivo faltante o corrupto. Si en el futuro se necesita configuracion sin tocar codigo, se puede migrar a un JSON externo sin cambiar la interfaz de `detectAlert()`. |
