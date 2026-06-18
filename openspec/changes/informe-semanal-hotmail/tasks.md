# Tasks: Informe Semanal de Hotmail

## Resumen del cambio

Pipeline de 14 pasos que consulta Microsoft Graph API por correos no leídos de Hotmail, detecta alertas de seguridad, construye un reporte HTML multipart/alternative, lo envía por Gmail API, marca los mensajes como leídos, persiste un checkpoint para idempotencia, y hace commit con `[skip ci]`.

---

## 1. Project bootstrap

Crear la estructura base del proyecto: `package.json`, `.gitignore`, `.env.example` y carpeta `openspec/changes/informe-semanal-hotmail/` (ya existe, confirmar y saltar si presente).

### Files to create or modify
- `package.json` — type: module, scripts `dev:once`, `dev:dry`, `start`
- `.gitignore` — node_modules, .env, .cache, state/*.local.json
- `.env.example` — las 6 variables de entorno con valores vacíos y comentarios

### Acceptance
- [ ] `npm install` se ejecuta sin errores aunque no haya dependencias (escenario `local-development: Archivo de ejemplo completo`)
- [ ] `npm run dev:dry` imprime un mensaje de error claro cuando faltan variables de entorno (escenario `local-development: Vista previa sin efectos secundarios`)
- [ ] `.env.example` lista las 6 variables: `MSAL_TOKEN_CACHE_JSON`, `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_REFRESH_TOKEN`, `GMAIL_DESTINATION_ADDRESS`, `HOTMAIL_ACCOUNT_ADDRESS` (escenario `secrets-configuration: Todos los secretos configurados`)
- [ ] `.gitignore` excluye `node_modules`, `.env`, `.cache` y `state/*.local.json` (escenario `local-development: Checkpoint local no versionado`)

### Dependencies
Ninguna

### Estimated size
Small (~30 lines)

---

## 2. Library modules

Crear los módulos de librería reutilizables que el resto del pipeline consume.

### Files to create or modify
- `scripts/lib/msal.mjs` — cargar MSAL token cache desde env, construir ConfidentialClientApplication, adquirir token silenciosamente (diseño 2.2)
- `scripts/lib/gmail.mjs` — construir cliente Gmail API autenticado con OAuth2, helper send con reintento 2x (diseño 2.8)
- `scripts/lib/checkpoint.mjs` — leer/escribir checkpoint JSON `state/reported-ids.json`, filtrar IDs ya reportados, lock basado en archivo (diseño 2.7)
- `scripts/lib/alerts.mjs` — `detectAlert(message)` retornando `{ isAlert, matchedCriteria }`, con listas hardcodeadas de 15 dominios de seguridad y 27 palabras clave bilingües (diseño 2.10)
- `scripts/lib/graph.mjs` — cliente Graph + `listRecentMessages(userId, daysBack, select)` con paginación y `@odata.nextLink` hasta 500 mensajes (diseño paso 5)
- `scripts/lib/templates.mjs` — renderizadores de plantillas HTML + texto plano (header, date group, message row, alert row, banner, footer, error report) (diseño 2.9)
- `scripts/lib/timezone.mjs` — helpers de zona horaria COL (UTC-5): `formatDateInCOL`, `getLastNDaysInCOL`, etc.
- `scripts/lib/logger.mjs` — logger estructurado a consola con niveles (info, warn, error)
- `scripts/lib/errors.mjs` — clases de error tipadas: `GraphError`, `GmailError`, `CheckpointError`, `TokenError`

### Acceptance
- [ ] `node -e "import('./scripts/lib/msal.mjs')"` no lanza error de sintaxis (diseño 2.2)
- [ ] `node -e "import('./scripts/lib/gmail.mjs')"` no lanza error de sintaxis (diseño 2.8)
- [ ] `node -e "import('./scripts/lib/checkpoint.mjs')"` no lanza error de sintaxis (diseño 2.7)
- [ ] `node -e "import('./scripts/lib/alerts.mjs')"` no lanza error de sintaxis; `getDefaultSecurityDomains()` retorna 15 dominios; `getDefaultSecurityKeywords()` retorna 27 palabras clave (diseño 2.10 + spec `security-alerts: Criterios de detección`)
- [ ] `node -e "import('./scripts/lib/graph.mjs')"` no lanza error de sintaxis (diseño paso 5)
- [ ] `node -e "import('./scripts/lib/templates.mjs')"` no lanza error de sintaxis (diseño 2.9)
- [ ] `node -e "import('./scripts/lib/timezone.mjs')"` no lanza error de sintaxis
- [ ] `node -e "import('./scripts/lib/logger.mjs')"` no lanza error de sintaxis
- [ ] `node -e "import('./scripts/lib/errors.mjs')"` no lanza error de sintaxis; `GraphError` extiende `Error` con propiedad `stage`

### Dependencies
WU-1 (package.json con `type: module`)

### Estimated size
Large (~350 líneas entre 9 módulos)

---

## 3. Adquisición Graph (paso 4) + detección de alertas (paso 5)

Implementar la consulta a Microsoft Graph API y el etiquetado de alertas de seguridad.

### Files to create or modify
- `scripts/build-digest.mjs` — parte inicial: cargar env, leer checkpoint, consultar Graph (GET /me/mailFolders/inbox/messages con paginación), ejecutar `detectAlert()` sobre cada mensaje nuevo, filtrar contra checkpoint, salida a stdout JSON si `--dry-run`

### Acceptance
- [ ] Construye filtro `$filter=receivedDateTime ge {now-7d}` con ventana rolling (escenario `graph-query: Ventana de 7 días desde la ejecución`)
- [ ] Solicita los 11 campos via `$select`: id, subject, sender, from, receivedDateTime, isRead, hasAttachments, importance, inferenceClassification, bodyPreview, toRecipients (escenario `graph-query: Proyección completa`)
- [ ] Sigue `@odata.nextLink` hasta 45 mensajes — recolecta todos (escenario `graph-query: Paginación completa bajo el límite`)
- [ ] Detiene paginación al alcanzar 500 mensajes (escenario `graph-query: Límite defensivo de 500`)
- [ ] Marca como alerta un mensaje cuyo dominio es `accountprotection.microsoft.com` (escenario `security-alerts: Coincide por dominio del remitente`)
- [ ] Marca como alerta un mensaje con asunto "Alerta de seguridad: nuevo inicio de sesion" (escenario `security-alerts: Coincide por palabra clave en asunto`)
- [ ] Marca como alerta un mensaje con importance=high pero dominio y asunto normales (escenario `security-alerts: Coincide por importancia alta`)
- [ ] No marca como alerta un mensaje sin coincidencias (escenario `security-alerts: Sin coincidencias`)
- [ ] `isAlert=true` y `matchedCriteria` contiene dos cadenas cuando el mensaje coincide con dominio Y palabra clave (escenario `security-alerts: Coincidencia con dos criterios`)
- [ ] Error de timeout lanza `GRAPH_CONNECTION_ERROR` y termina con código distinto de cero (escenario `graph-query: Timeout de red`)
- [ ] Token expirado lanza `GRAPH_AUTH_ERROR` y termina (escenario `graph-query: Token expirado sin renovación posible`)

### Dependencies
WU-2 (todos los módulos lib)

### Estimated size
Medium (~150 líneas)

---

## 4. Plantillas de reporte y builder

Implementar la construcción del reporte HTML + texto plano con todas las secciones.

### Files to create or modify
- `scripts/lib/templates.mjs` (completar funciones `buildReport` y `buildErrorReport`)
- `scripts/build-digest.mjs` (parte de construcción del reporte, paso 8)

### Acceptance
- [ ] `buildReport()` retorna `{ html, text, subject }` con estructura multipart/alternative (escenario `report: Renderizado en cliente de correo moderno`)
- [ ] Encabezado muestra "12 correos no leídos (8 Prioritarios, 4 Otros)" (escenario `report: Vista general`)
- [ ] Secciones agrupadas por fecha descendente: 17 jun antes que 16 jun (escenario `report: Organización temporal`)
- [ ] Fila normal con bodyPreview truncado a 240 caracteres y enlace a Outlook web (escenario `report: Fila normal con bodyPreview truncado`)
- [ ] Fila de alerta con bodyPreview completo en sección "Acciones requeridas" (escenario `report: Fila de alerta con bodyPreview completo`)
- [ ] Asunto sin alertas: `Reporte semanal Hotmail — 17 jun 2026` (escenario `report: Asunto sin alertas`)
- [ ] Asunto con alertas: `🚨 Reporte semanal Hotmail — 17 jun 2026` (escenario `report: Asunto con alertas`)
- [ ] Pie de página lista los 5 IDs procesados (escenario `report: Auditoría de mensajes`)
- [ ] Banner rojo con "⚠️ 2 alertas críticas detectadas" cuando hay 2 alertas (escenario `security-alerts: Banner con 2 alertas`)
- [ ] Sin alertas: banner no aparece en HTML (escenario `security-alerts: Sin alertas (banner)`)
- [ ] Sin alertas: sección "Acciones requeridas" no aparece (escenario `security-alerts: Sin alertas (sección)`)
- [ ] Una alerta: "Acciones requeridas" contiene fila con bodyPreview completo (escenario `security-alerts: Una alerta`)
- [ ] 5 alertas: sección contiene 5 filas con bodyPreview completo (escenario `security-alerts: Múltiples alertas`)
- [ ] Falso positivo: mensaje de `orders@shop.example.com` con "Verify your order shipped" se marca como alerta (escenario `security-alerts: Falso positivo por coincidencia de palabra clave`)

### Dependencies
WU-3 (mensajes etiquetados con isAlert disponibles)

### Estimated size
Medium (~200 líneas)

---

## 5. Envío a Gmail (paso 8)

Implementar el envío del reporte vía Gmail API.

### Files to create or modify
- `scripts/send-gmail.mjs` — recibe reporte, envía via Gmail API con OAuth2, reintento 2x

### Acceptance
- [ ] Con credenciales válidas, el cliente se autentica y puede enviar (escenario `gmail-delivery: Autenticación exitosa`)
- [ ] Refresh token inválido lanza `GMAIL_AUTH_ERROR` (escenario `gmail-delivery: Refresh token inválido o revocado`)
- [ ] Destinatario se lee de `GMAIL_DESTINATION_ADDRESS` (escenario `gmail-delivery: Variable configurada`)
- [ ] Variable ausente lanza `GMAIL_CONFIG_ERROR` (escenario `gmail-delivery: Variable ausente`)
- [ ] Error 500 en Gmail API: NO marca mensajes como leídos, NO actualiza checkpoint (escenario `gmail-delivery: Envío fallido, checkpoint preservado`)
- [ ] Con mock de Gmail client: send se llama 1 vez en éxito, 2 veces en fallo transitorio, lanza error tras 2 intentos (diseño 2.4 reintentos)

### Dependencies
WU-4 (reporte construido)

### Estimated size
Small (~80 líneas)

---

## 6. Marcado como leído (paso 9)

Implementar el marcado de mensajes como leídos usando Graph API batch.

### Files to create or modify
- `scripts/mark-read.mjs` — recibe lista de IDs, PATCH isRead=true en batches de 20, reintento 2x por batch

### Acceptance
- [ ] 3 mensajes (A, B, C) quedan con isRead=true después del PATCH (escenario `mark-read: Marcado exitoso de 3 mensajes`)
- [ ] 25 mensajes se envían en 2 batches (20 + 5) y todos quedan como leídos (escenario `mark-read: Batch de 20 mensajes`)
- [ ] Mensaje B eliminado: fallo parcial registra B como fallido, continúa con A y C (escenario `mark-read: Un mensaje ya no existe`)
- [ ] Token adquirido con scopes `["Mail.Read", "Mail.ReadWrite", "offline_access"]` (escenario `mark-read: Adquisición de token con scopes combinados`)
- [ ] Con mock Graph: llamadas batch ocurren en grupos máximo de 20; reintento en fallo transitorio

### Dependencies
WU-5 (envío exitoso debe ocurrir antes de marcar)

### Estimated size
Small (~100 líneas)

---

## 7. Checkpoint + git commit (pasos 10-11)

Implementar la escritura del checkpoint y el commit con `[skip ci]`.

### Files to create or modify
- `scripts/checkpoint-commit.mjs` — escribe checkpoint, ejecuta git add/commit/push con mensaje `[skip ci]`

### Acceptance
- [ ] Checkpoint escrito es JSON válido con campos `version`, `lastRunAt` y `reportedIds` (escenario `checkpoint: Archivo creado correctamente`)
- [ ] Sin checkpoint previo: se crea con `reportedIds` vacío y el script continúa (escenario `checkpoint: Primera ejecución`)
- [ ] Segunda ejecución: mensajes A, B, C (ya reportados) se excluyen, solo D aparece en el reporte (escenario `checkpoint: Ejecución duplicada el mismo día`)
- [ ] Commit message contiene `[skip ci]` y se ejecuta `git add state/reported-ids.json` (escenario `checkpoint: Commit exitoso`)
- [ ] Con mock git: el mensaje de commit contiene `[skip ci]` y el runId

### Dependencies
WU-6 (IDs marcados exitosamente disponibles)

### Estimated size
Small (~60 líneas)

---

## 8. Correo de error (ruta de fallo)

Implementar el envío de notificación de error cuando el pipeline falla.

### Files to create or modify
- `scripts/error-report.mjs` — construye y envía correo de error HTML + texto plano con stage, mensaje, stack truncado, run ID, run URL

### Acceptance
- [ ] Error en etapa `mark-read`: asunto `ERROR: Reporte semanal Hotmail — 2026-06-17T13:00:00.000Z` (escenario `failure-handling: Error en adquisición de datos`)
- [ ] Cuerpo del error contiene: `Stage: mark-read`, mensaje de error, stack truncado ≤2KB, Run ID, Run URL (escenario `failure-handling: Contenido completo del error`)
- [ ] Checkpoint NO se actualiza cuando envío exitoso pero marcado falla (escenario `failure-handling: Envío exitoso pero marcado falla`)
- [ ] Logs de GH Actions preservados para diagnóstico post-fallo (escenario `failure-handling: Diagnóstico post-fallo`)

### Dependencies
WU-5 (usa send-gmail.mjs para enviar el error)

### Estimated size
Small (~60 líneas)

---

## 9. Orquestador (entry point)

Implementar el script principal que orquesta los 14 pasos del pipeline.

### Files to create or modify
- `scripts/index.mjs` — punto de entrada único que valida env, ejecuta pasos 1-14 con manejo de errores en cada etapa

### Acceptance
- [ ] Valida que los 6 secretos existen como env vars al inicio (diseño paso 2)
- [ ] Env exitoso + mark-read exitoso + checkpoint escrito: flujo completo exitoso (diseño pasos 9-14)
- [ ] Fallo en adquisición: invoca error-report.mjs y sale non-zero sin efectos secundarios (diseño paso 5 fallo)
- [ ] Fallo en mark-read parcial: IDs fallidos reportados, checkpoint no se actualiza (diseño paso 10 fallo parcial)
- [ ] Fallo en commit: error-report se envía, checkpoint local actualizado pero no remoto (diseño paso 12 fallo)
- [ ] Sin mensajes nuevos: exit 0 sin envío, sin mark-read, sin checkpoint (diseño paso 7)
- [ ] Dry-run: reporte guardado en `.local/report-preview.html`, sin envío, sin mark-read, sin commit (escenario `local-development: Vista previa sin efectos secundarios`)
- [ ] Ejecución local completa (`dev:once`): consulta Graph, envía por Gmail, marca como leídos, checkpoint local actualizado sin commit (escenario `local-development: Ejecución local completa`)

### Dependencies
WU-3, WU-4, WU-5, WU-6, WU-7, WU-8

### Estimated size
Medium (~200 líneas)

---

## 10. GitHub Actions workflow

Crear el workflow YAML para ejecución programada y manual.

### Files to create or modify
- `.github/workflows/weekly-digest.yml` — cron `0 13 * * 1`, `workflow_dispatch` con input `dryRun`, permisos `contents: write`, steps: checkout, setup Node 20, npm install, npm run start

### Acceptance
- [ ] Cron ejecuta lunes 13:00 UTC = 8:00 COL (UTC-5) (decisión bloqueante 1)
- [ ] `workflow_dispatch` permite ejecución manual con input booleano `dryRun` (propósito: pruebas sin efectos secundarios)
- [ ] Jobs definidos: `validate` (verifica secretos) y `digest` (ejecuta pipeline)
- [ ] Paso post-ejecución rota `MSAL_TOKEN_CACHE_JSON` via `gh secret set` con `if: always()` (escenario `secrets-configuration: Token refrescado automáticamente`)
- [ ] `concurrency: weekly-digest` para evitar ejecución paralela (diseño 10.3)
- [ ] Permisos `contents: write` para commit del checkpoint (escenario `checkpoint: Commit exitoso`)
- [ ] Workflow YAML es válido (se puede verificar con `yamllint` o `act`)

### Dependencies
WU-9 (scripts implementados)

### Estimated size
Small (~60 líneas)

---

## 11. Experiencia de desarrollo local

Completar README.md con instrucciones concretas para desarrollo local.

### Files to create or modify
- `README.md` — instalar, configurar .env, ejecutar `dev:dry` (previsualización), ejecutar `dev:once` (real)

### Acceptance
- [ ] Un desarrollador nuevo puede seguir README y ejecutar `npm run dev:dry` en menos de 10 minutos (escenario `local-development: Onboarding de desarrollador`)
- [ ] README documenta que `.env` requiere las 6 variables (escenario `local-development: Archivo de ejemplo completo`)
- [ ] README incluye comando para regenerar token MSAL localmente (escenario `secrets-configuration: Setup inicial del token`)

### Dependencies
WU-1, WU-9 (scripts implementados para poder ejecutarlos)

### Estimated size
Small (~30 líneas)

---

## 12. Guía de despliegue

Completar README.md con sección de despliegue a GitHub Actions.

### Files to create or modify
- `README.md` — sección "Deploy to GitHub Actions" con paso a paso para cada secreto

### Acceptance
- [ ] README explica cómo obtener cada secreto: MSAL_TOKEN_CACHE_JSON (via npx @softeria/ms-365-mcp-server), GMAIL_OAUTH_CLIENT_ID/GMAIL_OAUTH_CLIENT_SECRET (Google Cloud Console), GMAIL_OAUTH_REFRESH_TOKEN (flujo OAuth2 con offline_access) (escenario `secrets-configuration: Setup Gmail OAuth2`)
- [ ] README incluye comando `gh secret set` para cada secreto
- [ ] README documenta rotación manual del token MSAL como fallback si la automática falla (diseño 7.5)
- [ ] Un repositorio nuevo puede configurarse en <30 minutos siguiendo el README (escenario `local-development: Onboarding de desarrollador`)

### Dependencies
WU-10 (workflow creado)

### Estimated size
Small (~50 líneas)

---

## Resumen de estimaciones

| WU | Nombre | Tamaño | Líneas estimadas |
|----|--------|--------|-----------------|
| 1 | Project bootstrap | Small | ~30 |
| 2 | Library modules | Large | ~350 |
| 3 | Adquisición Graph + alertas | Medium | ~150 |
| 4 | Report templates y builder | Medium | ~200 |
| 5 | Envío a Gmail | Small | ~80 |
| 6 | Marcado como leído | Small | ~100 |
| 7 | Checkpoint + git commit | Small | ~60 |
| 8 | Correo de error | Small | ~60 |
| 9 | Orquestador | Medium | ~200 |
| 10 | GitHub Actions workflow | Small | ~60 |
| 11 | Experiencia desarrollo local | Small | ~30 |
| 12 | Guía de despliegue | Small | ~50 |
| **Total** | | | **~1,370** |

### ⚠️ Chained PRs recommended: Yes

El total estimado (~1,370 líneas) excede ampliamente el presupuesto de revisión de 400 líneas. Se recomienda dividir en 3 PRs encadenados:

**PR 1: Base + adquisición + reporte** (~730 líneas)
- WU-1 (bootstrap)
- WU-2 (library modules)
- WU-3 (Graph acquisition + alert detection)
- WU-4 (report templates + builder)

**PR 2: Entrega + marcado + persistencia** (~300 líneas)
- WU-5 (send Gmail)
- WU-6 (mark-read)
- WU-7 (checkpoint + commit)
- WU-8 (error report)

**PR 3: Orquestación + workflow + documentación** (~340 líneas)
- WU-9 (orchestrator)
- WU-10 (GitHub Actions workflow)
- WU-11 (local dev experience)
- WU-12 (deployment walkthrough)

Cada PR es implementable por un sub-agente con contexto fresco en una sola sesión. El PR 1 y PR 2 pueden desarrollarse en paralelo (WU-1+2 son prerequisito de WU-3+4, y WU-5 depende de WU-4; pero WU-5+6+7+8 pueden planificarse contra la interfaz de WU-4). PR 3 requiere PR 1 y PR 2 completos.
