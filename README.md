# Mail Digest

> 🇪🇸 Estás leyendo el README en español. **[View in English →](README.en.md)**

Automatización semanal que consulta los correos no leídos de una cuenta
Hotmail (vía Microsoft Graph), construye un reporte HTML con detalle de cada
mensaje y lo entrega a una dirección Gmail configurada por el usuario. Los
correos reportados se marcan como leídos para evitar acumulación, y un
checkpoint local impide reportes duplicados si el workflow se ejecuta dos
veces el mismo día.

## Qué hace

1. Cada lunes a las 8:00 a.m. hora Colombia (UTC-5), un workflow de GitHub
   Actions se activa automáticamente.
2. El script `scripts/index.mjs` consulta Microsoft Graph por los correos
   no leídos de la bandeja de entrada recibidos en los últimos 7 días.
3. Detecta alertas de seguridad (correos de dominios conocidos, palabras
   clave de seguridad o `importance=high`) y las destaca con un banner rojo
   y una sección de acciones requeridas.
4. Construye un reporte HTML + texto plano con cada mensaje (remitente,
   asunto, fecha, importancia, adjuntos, fragmento del cuerpo).
5. Envía el reporte a la dirección Gmail configurada vía Gmail API OAuth2.
6. Marca los mensajes reportados como leídos.
7. Persiste un checkpoint con los IDs reportados y rota el cache de tokens
   MSAL para la próxima ejecución.

Si algo falla, el sistema envía un correo de error al mismo Gmail destino y
los logs de GitHub Actions quedan disponibles para diagnóstico.

## Prerrequisitos

- **Node.js 22 o superior** (probado con Node 24).
- **Una cuenta de GitHub** con permisos para crear Actions workflows y
  secrets en el repositorio destino.
- **Una cuenta personal de Hotmail / Outlook.com** (MSA). El script usa el
  tenant `consumers` de Microsoft Graph.
- **Una cuenta de Gmail** para recibir el reporte. Necesitas un proyecto
  en Google Cloud Console con Gmail API habilitada y credenciales OAuth2
  de tipo "Desktop application" (Client ID, Client Secret, Refresh Token
  con scope `gmail.send` y `access_type=offline`).

## Quick start

```bash
# 1. Instalar dependencias (npm o pnpm)
npm install
# — o —
pnpm install

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env y completar las 6 variables (ver .env.example para detalles)

# 3. Vista previa sin efectos secundarios (no envía, no marca como leído)
npm run dev:dry
# — o —
pnpm run dev:dry

# 4. Ejecución local completa (envía reporte, marca mensajes, escribe
#    checkpoint en state/reported-ids.json — sin commit al repo)
npm run dev:once
# — o —
pnpm run dev:once
```

## Setup inicial del token MSAL

Para que el script pueda leer correos de Hotmail/Outlook.com necesita un
**token cache de MSAL** válido. El cache es un JSON que MSAL produce
después de que un humano se autentica una vez con Microsoft.

El cache se genera localmente con el binario
`@softeria/ms-365-mcp-server` (el mismo servidor MCP que usa opencode):

```bash
# 1. Instalar el paquete (solo la primera vez)
npm install -g @softeria/ms-365-mcp-server
# — o —
pnpm add -g @softeria/ms-365-mcp-server

# 2. Autenticarse: se abre el navegador, hacés login con tu cuenta
#    de Hotmail/Outlook.com y el cache se imprime a stdout
npx @softeria/ms-365-mcp-server --login

# 3. Copiá el JSON que aparece en stdout (es un objeto largo con
#    campos "Account", "IdToken", "RefreshToken", etc.) y pegalo
#    como valor de MSAL_TOKEN_CACHE_JSON en tu .env
```

**Importante:** el token cache NO es lo mismo que un access token. Es
un blob JSON que contiene los refresh tokens y metadata necesaria para
que MSAL renueve automáticamente los access tokens. **Vencimiento
típico:** ~1 hora para access tokens, ~90 días para refresh tokens.

Cuando el workflow falle con `GRAPH_AUTH_ERROR` o errores
relacionados con "refresh token rejected", regenerá el cache con el
paso 2 y actualizá el secret en GitHub Actions
(`gh secret set MSAL_TOKEN_CACHE_JSON < nuevo-cache.json`).

## Estructura del proyecto

```
.
├── package.json                # type: module + scripts dev:once / dev:dry
├── .env.example                # template de variables de entorno
├── scripts/
│   ├── index.mjs               # entry point CLI (parsea --dry-run)
│   ├── build-digest.mjs        # adquisición Graph + alertas + reporte
│   └── lib/                    # módulos reutilizables
│       ├── msal.mjs
│       ├── gmail.mjs
│       ├── graph.mjs
│       ├── alerts.mjs
│       ├── checkpoint.mjs
│       ├── templates.mjs
│       ├── timezone.mjs
│       ├── logger.mjs
│       └── errors.mjs
└── openspec/changes/informe-semanal-hotmail/
    └── design.md               # arquitectura detallada
```

## Documentación adicional

- [`openspec/changes/informe-semanal-hotmail/design.md`](openspec/changes/informe-semanal-hotmail/design.md)
  — arquitectura completa, ciclo de vida del token MSAL, plantillas HTML,
  manejo de fallos y consideraciones operativas.
- [`openspec/changes/informe-semanal-hotmail/specs/`](openspec/changes/informe-semanal-hotmail/specs/)
  — especificaciones por dominio (graph-query, alerts, report, send,
    checkpoint, failure-handling, secrets, local-development).

## Deploy to GitHub Actions

El workflow corre automáticamente cada lunes 8:00 AM COL. Para
configurar los 6 secrets necesarios en tu fork:

### 1. Hotmail / Outlook.com

| Variable | Cómo obtenerla |
|---|---|
| `HOTMAIL_ACCOUNT_ADDRESS` | Tu dirección de Hotmail/Outlook.com (ej. `tu-cuenta@hotmail.com`) |
| `MSAL_TOKEN_CACHE_JSON` | Pegar el JSON completo que devuelve `npx @softeria/ms-365-mcp-server --login` (ver [Setup inicial del token MSAL](#setup-inicial-del-token-msal)) |

### 2. Gmail (OAuth2 Desktop application)

| Variable | Cómo obtenerla |
|---|---|
| `GMAIL_OAUTH_CLIENT_ID` | Google Cloud Console → APIs & Services → Credentials → tu OAuth 2.0 Client ID de tipo "Desktop app" |
| `GMAIL_OAUTH_CLIENT_SECRET` | El Client Secret correspondiente al Client ID anterior |
| `GMAIL_OAUTH_REFRESH_TOKEN` | Flujo OAuth2 con scope `https://www.googleapis.com/auth/gmail.send` y `access_type=offline`. Usar el "OAuth 2.0 Playground" de Google o un script local que haga el flujo y capture el refresh_token |
| `GMAIL_DESTINATION_ADDRESS` | La dirección Gmail donde querés recibir el reporte (puede ser la misma que autorizó la app, o cualquier otra que tenga permiso) |

### 3. Configurar los secrets con `gh` CLI

```bash
# Reemplazá los placeholders <...> con tus valores reales.
# Para MSAL_TOKEN_CACHE_JSON, pasá el JSON como archivo:

# Guardar el token cache en un archivo temporal
npx @softeria/ms-365-mcp-server --login > /tmp/msal-cache.json

# Configurar cada secret
gh secret set HOTMAIL_ACCOUNT_ADDRESS --body "tu-cuenta@hotmail.com"
gh secret set MSAL_TOKEN_CACHE_JSON < /tmp/msal-cache.json
gh secret set GMAIL_OAUTH_CLIENT_ID --body "<tu-client-id>"
gh secret set GMAIL_OAUTH_CLIENT_SECRET --body "<tu-client-secret>"
gh secret set GMAIL_OAUTH_REFRESH_TOKEN --body "<tu-refresh-token>"
gh secret set GMAIL_DESTINATION_ADDRESS --body "destino@gmail.com"

# Verificar que están todos
gh secret list
```

### 4. Activar el workflow

El workflow está en `.github/workflows/weekly-digest.yml`. Se ejecuta
automáticamente cada lunes 13:00 UTC (8 AM COL). También podés
dispararlo manualmente desde la pestaña "Actions" del repo con la
opción "Run workflow" → checkbox **dry run** para probar sin enviar
correos reales.

### 5. Rotación manual del token MSAL

El refresh token de MSAL vence ~90 días después del último login
interactivo. Cuando el workflow falle con `GRAPH_AUTH_ERROR`:

```bash
# 1. Regenerar el cache localmente
npx @softeria/ms-365-mcp-server --login > /tmp/msal-cache.json

# 2. Actualizar el secret
gh secret set MSAL_TOKEN_CACHE_JSON < /tmp/msal-cache.json

# 3. Re-disparar el workflow manualmente desde la pestaña Actions
```

**Tiempo total de setup en repo nuevo:** ~30 minutos siguiendo esta
guía (asumiendo que ya tenés cuenta de Hotmail y Gmail listas).

## Troubleshooting

Esta sección cubre los errores más comunes que aparecieron durante el
desarrollo y primer deploy. Si tu workflow falla, revisá acá antes de
abrir un issue.

### Error: `SyntaxError: Invalid or unexpected token` en los tests

**Causa:** archivos `.mjs` con CRLF (Windows line endings). Vitest no
tolera `\r\n` en ciertos contextos donde Node.js sí.

**Solución:**

```bash
# Convertir el archivo específico
sed -i 's/\r$//' scripts/index.mjs
```

**Prevención:** el repo incluye `.gitattributes` que fuerza LF para
todos los `.mjs`, `.js`, `.json`, `.md`. Si VS Code sigue abriendo
archivos en CRLF, agregá `"files.eol": "\n"` en tus User Settings
(`Ctrl+Shift+P` → "Preferences: Open User Settings (JSON)").

### Error: `unauthorized_client: The client does not exist or is not enabled for consumers` (Azure)

**Causa:** Azure App Registration fue creado con "Accounts in this
organizational directory only" en vez de "Personal Microsoft accounts
only". Las cuentas MSA (Hotmail/Outlook.com) NO funcionan con apps
single-tenant organizacionales.

**Solución:** borrar el app y crear uno nuevo con la opción correcta.
"Supported account types" **no se puede cambiar** después de crear.

### Error: `400: policy_enforced` al autorizar con Google

**Causa:** tu cuenta Gmail tiene activado el **Programa de Protección
Avanzada** (APP) de Google. APP bloquea TODAS las apps no verificadas
formalmente por Google, sin importar si están en modo "Testing".

**Solución:** usar otra cuenta Gmail que NO tenga APP. Para verificar
si tu cuenta tiene APP: https://myaccount.google.com/advancedprotection

### Error: `403: access_denied` al autorizar con Google

**Causa:** falta agregar tu email como **test user** en el OAuth
consent screen de Google Cloud Console.

**Solución:** Google Cloud Console → APIs & Services → OAuth consent
screen → Test users → + ADD USERS → agregar tu email.

### Error: `Unable to locate executable file: pnpm` en GitHub Actions

**Causa:** incompatibilidad entre `pnpm/action-setup@v4` y
`actions/setup-node@v4` con `cache: 'pnpm'` en Node 20+.

**Solución:** ya está arreglado en este repo usando **corepack** (que
viene con Node 20+). Si querés usar otro approach, el workflow YAML
tiene comentarios explicativos.

### Error: `Please tell me who you are` durante git commit en workflow

**Causa:** los runners de GitHub Actions NO tienen `user.name` /
`user.email` configurados por default.

**Solución:** ya está arreglado en este repo con un step "Configure
git identity" que corre antes del pipeline.

### Error: `Nothing to commit, working tree clean` en workflow

**Causa:** el orchestrator (con `--commit`) ya commiteó el checkpoint
internamente. El step "Commit checkpoint" del workflow es redundante.

**Solución:** ya está arreglado en este repo — el step redundante fue
eliminado.

### Warning: Node.js 20 deprecated en logs del workflow

**Causa:** GitHub está forzando runners a Node 24 porque Node 20 será
deprecated.

**Solución aplicada:** el workflow usa Node 22 (LTS) desde este PR. Si
ves este warning, es porque estás en una versión vieja del workflow —
actualizá a la última versión de `main`.

**TF-2 completada.** Ver `openspec/changes/informe-semanal-hotmail/tasks.md`
para el detalle de la migración.

## Forward de correos a cuenta principal

Si tuviste que crear una cuenta Gmail secundaria (por APP) y querés
recibir el reporte en tu cuenta principal:

1. Login en `cusuga004@gmail.com`
2. Settings (⚙️) → "See all settings" → "Forwarding and POP/IMAP"
3. Click "Add a forwarding address" → ingresar tu cuenta principal
4. Gmail envía código de confirmación — revisá tu bandeja de la cuenta
   principal
5. Si APP bloquea el link de confirmación, NO podés forwardear
   (ver TF-3 en tasks.md)
6. Si la confirmación funciona, elegí "keep Gmail's copy" o "mark as
   read and archive"

## Secrets y archivos sensibles

**NUNCA** commitees al repo:

- `client_secret_*.json` — descargados de Google Cloud Console
- `msal-cache.json` — output de scripts/get-msal-token-cache.mjs
- Tu `.env` local
- Cualquier output de los scripts de setup

El `.gitignore` ya excluye la mayoría de estos patrones. Si accidentalmente
commiteás uno, **rotá el secret inmediatamente** (regenerá el cache o
borrá la credencial en Google Cloud) — un secret en git history es
considerado comprometido aunque lo borres después.
