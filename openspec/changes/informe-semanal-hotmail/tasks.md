# Tasks: Informe Semanal de Hotmail

## Resumen del cambio

Pipeline de 14 pasos que consulta Microsoft Graph API por correos no leídos de Hotmail, detecta alertas de seguridad, construye un reporte HTML multipart/alternative, lo envía por Gmail API, marca los mensajes como leídos, persiste un checkpoint para idempotencia, y hace commit con `[skip ci]`.

---

## Estado de PRs

### ✅ PR 1 — Base + adquisición + reporte
**Commits en `origin/main`:** 5
- WU-1: Project bootstrap
- WU-2: Library modules (msal, gmail, graph, alerts, checkpoint, templates, timezone, logger, errors)
- WU-3: Graph acquisition + alert detection (build-digest.mjs pipeline)
- WU-4: Report templates + builder
- Tests: 213 tests, 89% coverage

### ✅ PR 2 — Entrega + marcado + persistencia + integración
**Pendiente commit:** awaiting user approval
- WU-5: Send Gmail (`scripts/send-gmail.mjs`)
- WU-6: Mark-read (`scripts/mark-read.mjs`)
- WU-7: Checkpoint + git commit (`scripts/checkpoint-commit.mjs`)
- WU-8: Error report (`scripts/error-report.mjs`)
- Integración en `scripts/build-digest.mjs`
- Tests actualizados (mock de `googleapis` agregado, 213 tests passing)

### ✅ PR 3a — Orquestador + tests
**Commits:** pendiente push a `origin/main`
- WU-9: Orchestrator (`scripts/index.mjs`)
- Tests del orchestrator (`tests/scripts/index.test.mjs`) — 40 tests
- 253/253 tests passing (213 previos + 40 nuevos)

### ✅ PR 3b — Workflow + documentación
**Commits:** pendiente push a `origin/main`
- WU-10: GitHub Actions workflow (`.github/workflows/weekly-digest.yml`)
- WU-11: Local dev experience (README — sección "Setup inicial del token MSAL")
- WU-12: Deployment walkthrough (README — sección "Deploy to GitHub Actions")

> **Decisión:** PR3 se dividió en 3a + 3b porque el total (~690 líneas) excede el presupuesto de revisión de 400 líneas. PR3a implementa y testea el orquestador; PR3b agrega el workflow YAML y la documentación de despliegue.

### ✅ Infraestructura
- pnpm migration: `package-lock.json` eliminado, `pnpm-lock.yaml` generado
- README bilingüe: español + inglés (`README.md`, `README.en.md`) con soporte para npm y pnpm

---

## 1. Project bootstrap ✅ (PR1)

Crear la estructura base del proyecto: `package.json`, `.gitignore`, `.env.example` y carpeta `openspec/changes/informe-semanal-hotmail/` (ya existe, confirmar y saltar si presente).

### Files to create or modify
- `package.json` — type: module, scripts `dev:once`, `dev:dry`, `start`
- `.gitignore` — node_modules, .env, .cache, state/*.local.json
- `.env.example` — las 6 variables de entorno con valores vacíos y comentarios

### Acceptance
- [x] `npm install` se ejecuta sin errores aunque no haya dependencias (escenario `local-development: Archivo de ejemplo completo`)
- [x] `npm run dev:dry` imprime un mensaje de error claro cuando faltan variables de entorno (escenario `local-development: Vista previa sin efectos secundarios`)
- [x] `.env.example` lista las 6 variables: `MSAL_TOKEN_CACHE_JSON`, `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_REFRESH_TOKEN`, `GMAIL_DESTINATION_ADDRESS`, `HOTMAIL_ACCOUNT_ADDRESS` (escenario `secrets-configuration: Todos los secretos configurados`)
- [x] `.gitignore` excluye `node_modules`, `.env`, `.cache` y `state/*.local.json` (escenario `local-development: Checkpoint local no versionado`)

### Dependencies
Ninguna

### Estimated size
Small (~30 lines)

---

## 2. Library modules ✅ (PR1)

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
- [x] `node -e "import('./scripts/lib/msal.mjs')"` no lanza error de sintaxis (diseño 2.2)
- [x] `node -e "import('./scripts/lib/gmail.mjs')"` no lanza error de sintaxis (diseño 2.8)
- [x] `node -e "import('./scripts/lib/checkpoint.mjs')"` no lanza error de sintaxis (diseño 2.7)
- [x] `node -e "import('./scripts/lib/alerts.mjs')"` no lanza error de sintaxis; `getDefaultSecurityDomains()` retorna 15 dominios; `getDefaultSecurityKeywords()` retorna 27 palabras clave (diseño 2.10 + spec `security-alerts: Criterios de detección`)
- [x] `node -e "import('./scripts/lib/graph.mjs')"` no lanza error de sintaxis (diseño paso 5)
- [x] `node -e "import('./scripts/lib/templates.mjs')"` no lanza error de sintaxis (diseño 2.9)
- [x] `node -e "import('./scripts/lib/timezone.mjs')"` no lanza error de sintaxis
- [x] `node -e "import('./scripts/lib/logger.mjs')"` no lanza error de sintaxis
- [x] `node -e "import('./scripts/lib/errors.mjs')"` no lanza error de sintaxis; `GraphError` extiende `Error` con propiedad `stage`

### Dependencies
WU-1 (package.json con `type: module`)

### Estimated size
Large (~350 líneas entre 9 módulos)

---

## 3. Adquisición Graph (paso 4) + detección de alertas (paso 5) ✅ (PR1)

Implementar la consulta a Microsoft Graph API y el etiquetado de alertas de seguridad.

### Files to create or modify
- `scripts/build-digest.mjs` — parte inicial: cargar env, leer checkpoint, consultar Graph (GET /me/mailFolders/inbox/messages con paginación), ejecutar `detectAlert()` sobre cada mensaje nuevo, filtrar contra checkpoint, salida a stdout JSON si `--dry-run`

### Acceptance
- [x] Construye filtro `$filter=receivedDateTime ge {now-7d}` con ventana rolling (escenario `graph-query: Ventana de 7 días desde la ejecución`)
- [x] Solicita los 11 campos via `$select`: id, subject, sender, from, receivedDateTime, isRead, hasAttachments, importance, inferenceClassification, bodyPreview, toRecipients (escenario `graph-query: Proyección completa`)
- [x] Sigue `@odata.nextLink` hasta 45 mensajes — recolecta todos (escenario `graph-query: Paginación completa bajo el límite`)
- [x] Detiene paginación al alcanzar 500 mensajes (escenario `graph-query: Límite defensivo de 500`)
- [x] Marca como alerta un mensaje cuyo dominio es `accountprotection.microsoft.com` (escenario `security-alerts: Coincide por dominio del remitente`)
- [x] Marca como alerta un mensaje con asunto "Alerta de seguridad: nuevo inicio de sesion" (escenario `security-alerts: Coincide por palabra clave en asunto`)
- [x] Marca como alerta un mensaje con importance=high pero dominio y asunto normales (escenario `security-alerts: Coincide por importancia alta`)
- [x] No marca como alerta un mensaje sin coincidencias (escenario `security-alerts: Sin coincidencias`)
- [x] `isAlert=true` y `matchedCriteria` contiene dos cadenas cuando el mensaje coincide con dominio Y palabra clave (escenario `security-alerts: Coincidencia con dos criterios`)
- [x] Error de timeout lanza `GRAPH_CONNECTION_ERROR` y termina con código distinto de cero (escenario `graph-query: Timeout de red`)
- [x] Token expirado lanza `GRAPH_AUTH_ERROR` y termina (escenario `graph-query: Token expirado sin renovación posible`)

### Dependencies
WU-2 (todos los módulos lib)

### Estimated size
Medium (~150 líneas)

---

## 4. Plantillas de reporte y builder ✅ (PR1)

Implementar la construcción del reporte HTML + texto plano con todas las secciones.

### Files to create or modify
- `scripts/lib/templates.mjs` (completar funciones `buildReport` y `buildErrorReport`)
- `scripts/build-digest.mjs` (parte de construcción del reporte, paso 8)

### Acceptance
- [x] `buildReport()` retorna `{ html, text, subject }` con estructura multipart/alternative (escenario `report: Renderizado en cliente de correo moderno`)
- [x] Encabezado muestra "12 correos no leídos (8 Prioritarios, 4 Otros)" (escenario `report: Vista general`)
- [x] Secciones agrupadas por fecha descendente: 17 jun antes que 16 jun (escenario `report: Organización temporal`)
- [x] Fila normal con bodyPreview truncado a 240 caracteres y enlace a Outlook web (escenario `report: Fila normal con bodyPreview truncado`)
- [x] Fila de alerta con bodyPreview completo en sección "Acciones requeridas" (escenario `report: Fila de alerta con bodyPreview completo`)
- [x] Asunto sin alertas: `Reporte semanal Hotmail — 17 jun 2026` (escenario `report: Asunto sin alertas`)
- [x] Asunto con alertas: `🚨 Reporte semanal Hotmail — 17 jun 2026` (escenario `report: Asunto con alertas`)
- [x] Pie de página lista los 5 IDs procesados (escenario `report: Auditoría de mensajes`)
- [x] Banner rojo con "⚠️ 2 alertas críticas detectadas" cuando hay 2 alertas (escenario `security-alerts: Banner con 2 alertas`)
- [x] Sin alertas: banner no aparece en HTML (escenario `security-alerts: Sin alertas (banner)`)
- [x] Sin alertas: sección "Acciones requeridas" no aparece (escenario `security-alerts: Sin alertas (sección)`)
- [x] Una alerta: "Acciones requeridas" contiene fila con bodyPreview completo (escenario `security-alerts: Una alerta`)
- [x] 5 alertas: sección contiene 5 filas con bodyPreview completo (escenario `security-alerts: Múltiples alertas`)
- [x] Falso positivo: mensaje de `orders@shop.example.com` con "Verify your order shipped" se marca como alerta (escenario `security-alerts: Falso positivo por coincidencia de palabra clave`)

### Dependencies
WU-3 (mensajes etiquetados con isAlert disponibles)

### Estimated size
Medium (~200 líneas)

---

## 5. Envío a Gmail (paso 8) ✅ (PR2 — pendiente approval)

Implementar el envío del reporte vía Gmail API.

### Files to create or modify
- `scripts/send-gmail.mjs` — recibe reporte, envía via Gmail API con OAuth2, reintento 2x

### Acceptance
- [x] Con credenciales válidas, el cliente se autentica y puede enviar (escenario `gmail-delivery: Autenticación exitosa`)
- [x] Refresh token inválido lanza `GMAIL_AUTH_ERROR` (escenario `gmail-delivery: Refresh token inválido o revocado`)
- [x] Destinatario se lee de `GMAIL_DESTINATION_ADDRESS` (escenario `gmail-delivery: Variable configurada`)
- [x] Variable ausente lanza `GMAIL_CONFIG_ERROR` (escenario `gmail-delivery: Variable ausente`)
- [x] Error 500 en Gmail API: NO marca mensajes como leídos, NO actualiza checkpoint (escenario `gmail-delivery: Envío fallido, checkpoint preservado`)
- [x] Con mock de Gmail client: send se llama 1 vez en éxito, 2 veces en fallo transitorio, lanza error tras 2 intentos (diseño 2.4 reintentos)

### Dependencies
WU-4 (reporte construido)

### Estimated size
Small (~80 líneas)

---

## 6. Marcado como leído (paso 9) ✅ (PR2 — pendiente approval)

Implementar el marcado de mensajes como leídos usando Graph API batch.

### Files to create or modify
- `scripts/mark-read.mjs` — recibe lista de IDs, PATCH isRead=true en batches de 20, reintento 2x por batch

### Acceptance
- [x] 3 mensajes (A, B, C) quedan con isRead=true después del PATCH (escenario `mark-read: Marcado exitoso de 3 mensajes`)
- [x] 25 mensajes se envían en 2 batches (20 + 5) y todos quedan como leídos (escenario `mark-read: Batch de 20 mensajes`)
- [x] Mensaje B eliminado: fallo parcial registra B como fallido, continúa con A y C (escenario `mark-read: Un mensaje ya no existe`)
- [x] Token adquirido con scopes `["Mail.Read", "Mail.ReadWrite", "offline_access"]` (escenario `mark-read: Adquisición de token con scopes combinados`)
- [x] Con mock Graph: llamadas batch ocurren en grupos máximo de 20; reintento en fallo transitorio

### Dependencies
WU-5 (envío exitoso debe ocurrir antes de marcar)

### Estimated size
Small (~100 líneas)

---

## 7. Checkpoint + git commit (pasos 10-11) ✅ (PR2 — pendiente approval)

Implementar la escritura del checkpoint y el commit con `[skip ci]`.

### Files to create or modify
- `scripts/checkpoint-commit.mjs` — escribe checkpoint, ejecuta git add/commit/push con mensaje `[skip ci]`

### Acceptance
- [x] Checkpoint escrito es JSON válido con campos `version`, `lastRunAt` y `reportedIds` (escenario `checkpoint: Archivo creado correctamente`)
- [x] Sin checkpoint previo: se crea con `reportedIds` vacío y el script continúa (escenario `checkpoint: Primera ejecución`)
- [x] Segunda ejecución: mensajes A, B, C (ya reportados) se excluyen, solo D aparece en el reporte (escenario `checkpoint: Ejecución duplicada el mismo día`)
- [x] Commit message contiene `[skip ci]` y se ejecuta `git add state/reported-ids.json` (escenario `checkpoint: Commit exitoso`)
- [x] Con mock git: el mensaje de commit contiene `[skip ci]` y el runId

### Dependencies
WU-6 (IDs marcados exitosamente disponibles)

### Estimated size
Small (~60 líneas)

---

## 8. Correo de error (ruta de fallo) ✅ (PR2 — pendiente approval)

Implementar el envío de notificación de error cuando el pipeline falla.

### Files to create or modify
- `scripts/error-report.mjs` — construye y envía correo de error HTML + texto plano con stage, mensaje, stack truncado, run ID, run URL

### Acceptance
- [x] Error en etapa `mark-read`: asunto `ERROR: Reporte semanal Hotmail — 2026-06-17T13:00:00.000Z` (escenario `failure-handling: Error en adquisición de datos`)
- [x] Cuerpo del error contiene: `Stage: mark-read`, mensaje de error, stack truncado ≤2KB, Run ID, Run URL (escenario `failure-handling: Contenido completo del error`)
- [x] Checkpoint NO se actualiza cuando envío exitoso pero marcado falla (escenario `failure-handling: Envío exitoso pero marcado falla`)
- [x] Logs de GH Actions preservados para diagnóstico post-fallo (escenario `failure-handling: Diagnóstico post-fallo`)

### Dependencies
WU-5 (usa send-gmail.mjs para enviar el error)

### Estimated size
Small (~60 líneas)

---

## 9. Orquestador (entry point) ✅ (PR3a)

Implementar el script principal que orquesta los 14 pasos del pipeline.

### Files to create or modify
- `scripts/index.mjs` — punto de entrada único que valida env, ejecuta pasos 1-14 con manejo de errores en cada etapa

### Acceptance
- [x] Valida que los 6 secretos existen como env vars al inicio (diseño paso 2)
- [x] Env exitoso + mark-read exitoso + checkpoint escrito: flujo completo exitoso (diseño pasos 9-14)
- [x] Fallo en adquisición: error email enviado via gmail.mjs, sale non-zero sin efectos secundarios (diseño paso 5 fallo)
- [x] Fallo en mark-read parcial: IDs fallidos reportados, checkpoint no se actualiza (diseño paso 10 fallo parcial)
- [x] Fallo en commit: error-report se envía, checkpoint local actualizado pero no remoto (diseño paso 12 fallo)
- [x] Sin mensajes nuevos: exit 0 sin envío, sin mark-read, sin checkpoint (diseño paso 7)
- [x] Dry-run: reporte guardado en `.local/report-preview.html`, sin envío, sin mark-read, sin commit (escenario `local-development: Vista previa sin efectos secundarios`)
- [x] Ejecución local completa (`dev:once`): consulta Graph, envía por Gmail, marca como leídos, checkpoint local actualizado sin commit (escenario `local-development: Ejecución local completa`)

### Dependencies
WU-3, WU-4, WU-5, WU-6, WU-7, WU-8

### Estimated size
Medium (~200 líneas)

---

## 10. GitHub Actions workflow ✅ (PR3b)

Crear el workflow YAML para ejecución programada y manual.

### Files to create or modify
- `.github/workflows/weekly-digest.yml` — cron `0 13 * * 1`, `workflow_dispatch` con input `dryRun`, permisos `contents: write`, steps: checkout, setup Node 20, npm install, npm run start

### Acceptance
- [x] Cron ejecuta lunes 13:00 UTC = 8:00 COL (UTC-5) (decisión bloqueante 1)
- [x] `workflow_dispatch` permite ejecución manual con input booleano `dryRun` (propósito: pruebas sin efectos secundarios)
- [x] Jobs definidos: `validate` (verifica secretos) y `digest` (ejecuta pipeline)
- [x] Rotación de token documentada como procedimiento MANUAL en README (escenario `secrets-configuration: Token refrescado automáticamente`) — sin step automático en el workflow
- [x] `concurrency: weekly-digest` para evitar ejecución paralela (diseño 10.3)
- [x] Permisos `contents: write` para commit del checkpoint (escenario `checkpoint: Commit exitoso`)
- [x] Workflow YAML es válido (verificado con validador online)

### Dependencies
WU-9 (scripts implementados)

### Estimated size
Small (~60 líneas)

---

## 11. Experiencia de desarrollo local ✅ (PR3b)

Completar README.md con instrucciones concretas para desarrollo local.

### Files to create or modify
- `README.md` — instalar, configurar .env, ejecutar `dev:dry` (previsualización), ejecutar `dev:once` (real)

### Acceptance
- [x] Un desarrollador nuevo puede seguir README y ejecutar `npm run dev:dry` en menos de 10 minutos (escenario `local-development: Onboarding de desarrollador`)
- [x] README documenta que `.env` requiere las 6 variables (escenario `local-development: Archivo de ejemplo completo`)
- [x] README incluye comando para regenerar token MSAL localmente (escenario `secrets-configuration: Setup inicial del token`)

### Dependencies
WU-1, WU-9 (scripts implementados para poder ejecutarlos)

### Estimated size
Small (~30 líneas)

---

## 12. Guía de despliegue ✅ (PR3b)

Completar README.md con sección de despliegue a GitHub Actions.

### Files to create or modify
- `README.md` — sección "Deploy to GitHub Actions" con paso a paso para cada secreto

### Acceptance
- [x] README explica cómo obtener cada secreto: MSAL_TOKEN_CACHE_JSON (via npx @softeria/ms-365-mcp-server), GMAIL_OAUTH_CLIENT_ID/GMAIL_OAUTH_CLIENT_SECRET (Google Cloud Console), GMAIL_OAUTH_REFRESH_TOKEN (flujo OAuth2 con offline_access) (escenario `secrets-configuration: Setup Gmail OAuth2`)
- [x] README incluye comando `gh secret set` para cada secreto
- [x] README documenta rotación manual del token MSAL como fallback si la automática falla (diseño 7.5)
- [x] Un repositorio nuevo puede configurarse en <30 minutos siguiendo el README (escenario `local-development: Onboarding de desarrollador`)

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

### Estado: PR1 ✅ mergeado | PR2 ✅ mergeado | PR3a ✅ mergeado | PR3b ✅ done (pending push)

El total estimado (~1,370 líneas) se dividió en 4 PRs encadenados:

**PR 1: Base + adquisición + reporte** ✅ mergeado a `origin/main`
- WU-1 (bootstrap)
- WU-2 (library modules)
- WU-3 (Graph acquisition + alert detection)
- WU-4 (report templates + builder)
- 5 commits en `origin/main`

**PR 2: Entrega + marcado + persistencia + pnpm migration** ✅ mergeado a `origin/main`
- WU-5 (send Gmail)
- WU-6 (mark-read)
- WU-7 (checkpoint + commit)
- Integración en `build-digest.mjs`
- pnpm migration
- Archivos: `scripts/send-gmail.mjs`, `scripts/mark-read.mjs`, `scripts/checkpoint-commit.mjs`, `tests/scripts/*.test.mjs`, `.gitignore`, `pnpm-lock.yaml`

**PR 3a: Orquestador + tests** ✅ done (~450 líneas, pending push)
- WU-9 (orchestrator `scripts/index.mjs`)
- Tests del orchestrator (`tests/scripts/index.test.mjs`) — 40 tests

**PR 3b: Workflow + documentación** ✅ done (~240 líneas, pending push)
- WU-10 (GitHub Actions workflow `.github/workflows/weekly-digest.yml`)
- WU-11 (local dev experience — README sección MSAL setup)
- WU-12 (deployment walkthrough — README sección Deploy to GitHub Actions)

> **Decisión de split:** PR3 se dividió en 3a + 3b porque el total (~690 líneas) excede el presupuesto de revisión de 400 líneas. PR3a implementa y testea el orquestador; PR3b agrega el workflow YAML y la documentación de despliegue.

---

## Tareas futuras (post-lanzamiento)

Estas tareas surgieron durante el setup y primer run del workflow. No son parte del change actual pero deben abordarse en futuras iteraciones.

### TF-1: Cleanup de Google Cloud Console ✅ COMPLETADA

**Tarea:** Borrar la primera aplicación de Google Cloud Console que se creó durante el setup inicial (la del Client ID `1071767063912-tn3n45ph58ijcro4rpvi6321tkj0ohro`) porque ya no se usa.

**Pasos:**
1. Ir a https://console.cloud.google.com/
2. Seleccionar el proyecto que contiene la app no usada
3. APIs & Services → Credentials
4. Identificar el OAuth 2.0 Client ID a borrar (verificar con el ID arriba)
5. Click en la credencial → Delete
6. (Opcional) Si el proyecto entero no se va a usar más, también se puede borrar el proyecto

**Riesgo:** bajo, siempre y cuando no haya otros sistemas usando ese Client ID.

**Resolución aplicada:**
- Credencial OAuth 2.0 Client ID `1071767063912-tn3n45ph58ijcro4rpvi6321tkj0ohro` borrada de Google Cloud Console
- El secret `GMAIL_OAUTH_CLIENT_ID` en GitHub Actions sigue apuntando al Client ID nuevo (`371674345711-...`) que es el que funciona
- No se borró el proyecto entero — puede contener otras APIs/recursos útiles en el futuro

---

### TF-2: Migrar workflow de Node 20 a Node 22 (o 24) ✅ COMPLETADA

**Tarea:** Resolver el warning de Node.js 20 deprecated en GitHub Actions. GitHub está forzando a los workflows a correr en Node 24 por default porque Node 20 será deprecated.

**Warning actual:**
```
Warning: Node.js 20 is deprecated. The following actions target Node.js 20
but are being forced to run on Node 24: actions/checkout@v4, actions/setup-node@v4.
```

**Cambio requerido:** editar `.github/workflows/weekly-digest.yml` línea donde dice `node-version: '20'` y cambiarlo a `'22'` (LTS actual) o `'24'` (latest).

**Dificultad:** trivial — un solo cambio de string en el workflow YAML.

**Consecuencias de NO arreglarlo:**
- GitHub va a empezar a tirar errores en vez de warnings cuando Node 20 se retire completamente
- Las actions de terceros (actions/checkout, setup-node) ya están siendo forzadas a Node 24, así que técnicamente ya funciona
- Si los dependencies del proyecto (ej. `@azure/msal-node`, `googleapis`) requieren Node 20 específicamente, podría haber incompatibilidades futuras
- Por ahora: el warning es cosmético y no rompe nada

**Recomendación:** migrar a Node 22 (LTS) en el próximo PR pequeño. Verificar que `@azure/msal-node` 3.5+ y `googleapis` 144+ soporten Node 22 (deberían porque es LTS desde octubre 2022).

**Resolución aplicada:**
- Cambiado `node-version: '20'` → `node-version: '22'` en `.github/workflows/weekly-digest.yml`
- Actualizado `engines.node` en `package.json` a `>=22`
- Actualizada la mención en README (ambos idiomas) de "Node 20" a "Node 22"
- `@azure/msal-node` 3.5+ y `googleapis` 144+ ambos soportan Node 22 LTS sin issues

---

### TF-3: Forward de correos de Gmail secundario a Gmail principal ✅ COMPLETADA

**Tarea:** Reenviar los correos que llegan a `cusuga004@gmail.com` (la cuenta nueva creada para evitar APP) a la cuenta principal `carlosusugamartinez@gmail.com` (que tiene APP activado).

**Problema:** La cuenta principal tiene Google Advanced Protection Program activado, lo que bloquea apps no verificadas. Por eso creamos la cuenta secundaria como destino del reporte. Pero queremos leer el reporte desde la cuenta principal.

**Opciones:**

**A) Forward automático desde Gmail (más simple)**
1. Abrir sesión en `cusuga004@gmail.com`
2. Settings (⚙️) → "See all settings" → "Forwarding and POP/IMAP"
3. Click "Add a forwarding address"
4. Ingresar `carlosusugamartinez@gmail.com`
5. Gmail envía un código de confirmación a la cuenta principal
6. Confirmar el código (esto puede fallar si APP bloquea el link de confirmación)
7. Elegir qué hacer con los correos reenviados: "keep Gmail's copy in the inbox" o "mark as read and archive"
8. Opcional: crear filter para forwardear SOLO correos con subject "Reporte semanal Hotmail"

**B) Polling con el Gmail API (más robusto)**
Modificar el script para que después de enviar el reporte, también lo reenvíe a la cuenta principal usando el `users.messages.forward` endpoint de Gmail API.

**C) Usar la cuenta secundaria permanentemente como inbox del reporte**
Renunciar a la integración con la cuenta principal y usar `cusuga004@gmail.com` como inbox designada para el reporte semanal.

**Recomendación:** A) por simplicidad. Si el link de confirmación falla por APP, probar C) como fallback.

**Resolución aplicada:**
- Forward configurado desde `cusuga004@gmail.com` → `carlosusugamartinez@gmail.com`
- Opción "keep Gmail's copy in the inbox" seleccionada
- Confirmación funcionó — APP NO bloqueó el link de confirmación (sorpresa positiva)
- El reporte semanal ahora llega a ambas cuentas sin código adicional

---

### TF-4 (V2): Investigar uso de Gmail API via MCP ❌ NO VIABLE — cerrado

**Tarea:** Investigar si se puede usar el "MCP Gmail API" (https://developers.google.com/workspace/gmail/api/reference/mcp?hl=es_419) para evitar el OAuth2 flow tradicional y así poder usar la cuenta principal con APP activado.

**Contexto:** Google ofrece un MCP (Model Context Protocol) server oficial para Gmail API. Si este MCP permite acceso a la API sin pasar por el OAuth consent screen tradicional, podríamos bypassear el bloqueo de APP.

**Rama:** crear rama secundaria `feat/mcp-gmail-api` para investigación. NO desarrollar en main hasta validar que el approach funciona.

**Pasos:**
1. Revisar la documentación oficial en https://developers.google.com/workspace/gmail/api/reference/mcp
2. Evaluar si el MCP server es compatible con la API actual (gmail.send scope)
3. Si es viable: diseñar V2 de la app que use el MCP server en vez de googleapis
4. Si NO es viable: documentar el hallazgo y cerrar TF-4 como "no aplicable"
5. Probar específicamente con `carlosusugamartinez@gmail.com` (la cuenta con APP) para validar que el MCP bypass funciona

**Criterio de éxito:** poder enviar el reporte semanal a la cuenta principal usando el MCP server, sin necesidad de cuenta Gmail secundaria.

**Estimación:** 1-2 días de investigación + posible implementación nueva.

**Resolución — TF-4 cerrado como no viable:**
- Investigación completa en `tf4-investigation.md` (en este mismo directorio)
- **No hay herramienta `send_message` en el MCP de Gmail** — solo lectura y organización
- El MCP usa OAuth2 tradicional, NO bypassea APP
- TF-3 (forward de Gmail) es la solución adoptada y funciona
- Decisión: cerrar TF-4, no continuar con Apps Script ni servicios terceros (el forward es suficiente)

**Próximas alternativas posibles (no implementadas, baja prioridad):**
- Apps Script como proxy (corre en infra de Google, bypassea APP)
- Servicios de email de terceros (SendGrid, Mailgun, etc.)
- Mantener forward (ya implementado, funciona)
