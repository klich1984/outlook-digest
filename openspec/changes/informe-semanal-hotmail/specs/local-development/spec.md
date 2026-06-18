# Local Development — Especificación

## Propósito

Especificar el entorno de desarrollo local que permite probar el workflow sin ejecutarlo en GitHub Actions.

## Requisitos

### Requisito: Variables de entorno documentadas

El proyecto DEBE incluir un archivo `.env.example` que liste todas las variables de entorno requeridas con valores de ejemplo o descripciones.

#### Escenario: Archivo de ejemplo completo

- DADO que un nuevo desarrollador clona el repositorio
- CUANDO revisa `.env.example`
- ENTONCES encuentra todas las variables: `MSAL_TOKEN_CACHE_JSON`, `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_REFRESH_TOKEN`, `GMAIL_DESTINATION_ADDRESS`

### Requisito: Comando npm run dev:once

El `package.json` DEBE incluir un script `dev:once` que ejecute el workflow completo localmente (sin cron, sin commit de checkpoint). El checkpoint se escribe en un archivo local, no se commitea.

#### Escenario: Ejecución local completa

- DADO que el desarrollador ejecuta `npm run dev:once`
- CUANDO el script se ejecuta
- ENTONCES consulta Graph, genera reporte, envía por Gmail, marca como leídos, y actualiza el checkpoint local

### Requisito: Comando npm run dev:dry

El `package.json` DEBE incluir un script `dev:dry` que ejecute el pipeline pero skipe el envío real y el marcado como leídos. El reporte se imprime a la consola o se guarda como archivo HTML local.

#### Escenario: Vista previa sin efectos secundarios

- DADO que el desarrollador ejecuta `npm run dev:dry`
- CUANDO el script se ejecuta
- ENTONCES el reporte HTML se guarda en `./.local/report-preview.html` y NO se envía por Gmail NI se marcan mensajes como leídos

### Requisito: README con instrucciones de setup

El README DEBE explicar: `npm install`, configuración de `.env`, ejecución local con `npm run dev:once`, ejecución dry-run con `npm run dev:dry`, y pasos para desplegar los secrets en GitHub.

#### Escenario: Onboarding de desarrollador

- DADO que un desarrollador sigue el README
- CUANDO ejecuta los pasos en orden
- ENTONCES puede ejecutar el workflow localmente en menos de 10 minutos

### Requisito: Checkpoint local basado en archivo

En entorno local, el checkpoint se escribe en `state/reported-ids.json` localmente pero NO se hace commit. El usuario puede borrarlo manualmente para forzar un re-procesamiento.

#### Escenario: Checkpoint local no versionado

- DADO que `.gitignore` incluye `state/reported-ids.json`
- CUANDO se ejecuta localmente
- ENTONCES el checkpoint se escribe en disco pero no se sube al repositorio
