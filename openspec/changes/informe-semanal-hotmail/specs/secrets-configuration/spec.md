# Secrets Configuration — Especificación

## Propósito

Especificar la configuración de secretos de GitHub necesarios para la autenticación tanto con Microsoft Graph (Hotmail) como con Gmail API.

## Requisitos

### Requisito: Secretos de GitHub requeridos

El workflow DEBE leer los siguientes secretos de GitHub Actions: `HOTMAIL_ACCOUNT_ADDRESS`, `MSAL_TOKEN_CACHE_JSON`, `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_REFRESH_TOKEN`, `GMAIL_DESTINATION_ADDRESS`.

#### Escenario: Todos los secretos configurados

- DADO que los 5 secretos existen en el repositorio
- CUANDO el workflow se ejecuta
- ENTONCES cada script puede acceder a su secreto correspondiente via `process.env`

#### Escenario: Secreto faltante

- DADO que `GMAIL_OAUTH_CLIENT_SECRET` no está configurado
- CUANDO el script de Gmail intenta inicializar OAuth2
- ENTONCES el script falla con `GMAIL_CONFIG_ERROR` indicando el secreto faltante

### Requisito: Generación del token cache MSAL

El `MSAL_TOKEN_CACHE_JSON` se genera localmente ejecutando `npx @softeria/ms-365-mcp-server --login` con los scopes `Mail.Read`, `Mail.ReadWrite` y `offline_access`. El token cache resultante se exporta desde el credential store del usuario.

#### Escenario: Setup inicial del token

- DADO que el usuario ejecuta el comando de login local con el valor de `HOTMAIL_ACCOUNT_ADDRESS`
- CUANDO completa la autenticación con MSA en su cuenta personal
- ENTONCES el token cache JSON se exporta y se almacena como secreto de GitHub `MSAL_TOKEN_CACHE_JSON`

### Requisito: Rotación del token cache post-ejecución

El workflow DEBE incluir un paso post-ejecución que capture el token cache actualizado (MSAL rota el refresh token internamente) y lo persista de vuelta al mismo secreto de GitHub usando `gh secret set`.

#### Escenario: Token refrescado automáticamente

- DADO que MSAL reemplazó el refresh token durante la ejecución
- CUANDO el paso post-ejecución se ejecuta
- ENTONCES el secreto `MSAL_TOKEN_CACHE_JSON` se actualiza con el nuevo cache

### Requisito: Obtención de credenciales Gmail OAuth2

Las credenciales Gmail se obtienen creando un proyecto en Google Cloud Console, habilitando Gmail API, creando un OAuth Client ID para aplicación de escritorio, y generando un refresh token via el flujo de `offline_access`.

#### Escenario: Setup Gmail OAuth2

- DADO que el usuario crea un proyecto en Google Cloud Console
- CUANDO configura OAuth consent screen y crea credenciales
- ENTONCES obtiene `client_id`, `client_secret` y `refresh_token` para configurar como secretos
