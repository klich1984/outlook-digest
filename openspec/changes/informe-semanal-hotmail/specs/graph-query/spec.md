# Graph Query — Especificación

## Propósito

Especificar la adquisición de datos fuente desde Microsoft Graph API (tenant `consumers`) para obtener los mensajes no leídos de los últimos 7 días desde la bandeja de entrada de Hotmail.

## Requisitos

### Requisito: Ventana de fecha dinámica (rolling)

El sistema DEBE calcular la ventana de fecha como `[now - 7 días, now]` en tiempo de ejecución, NO como una semana calendario fija.

#### Escenario: Ventana de 7 días desde la ejecución

- DADO que el workflow se ejecuta un miércoles 2026-06-17 a las 13:00 UTC
- CUANDO el script construye el filtro `$filter`
- ENTONCES el filtro DEBE ser `receivedDateTime ge 2026-06-10T13:00:00Z`

### Requisito: Campos seleccionados

La query DEBE solicitar explícitamente los siguientes campos via `$select`: `id`, `subject`, `sender`, `from`, `receivedDateTime`, `isRead`, `hasAttachments`, `importance`, `inferenceClassification`, `bodyPreview`, `toRecipients`.

#### Escenario: Proyección completa

- DADO que el script ejecuta `GET /me/mailFolders/inbox/messages`
- CUANDO se especifica `$select`
- ENTONCES cada mensaje devuelto DEBE contener los 11 campos requeridos

### Requisito: Paginación hasta 500 mensajes

El script DEBE seguir `@odata.nextLink` hasta agotar los resultados o alcanzar un máximo de 500 mensajes, lo que ocurra primero. El límite de 500 es defensivo: una semana de correos no leídos raramente excede 100, pero protege contra bucles infinitos.

#### Escenario: Paginación completa bajo el límite

- DADO que hay 45 mensajes en la ventana
- CUANDO el script itera las páginas (50 por página)
- ENTONCES el script recolecta los 45 mensajes sin error

#### Escenario: Límite defensivo de 500

- DADO que hay más de 500 mensajes en la ventana (caso extremo)
- CUANDO el script alcanza 500 mensajes acumulados
- ENTONCES el script DETIENE la paginación y procesa los 500 mensajes

### Requisito: Error de conexión aborta la ejecución

Si la conexión a Microsoft Graph falla (timeout, DNS, 401, 403, 429), el script DEBE fallar con un mensaje claro y ABORTAR antes de cualquier efecto secundario (no escribe checkpoint, no envía email, no marca como leído).

#### Escenario: Timeout de red

- DADO que Microsoft Graph no responde en 30 segundos
- CUANDO el script intenta la primera petición
- ENTONCES el script lanza un error `GRAPH_CONNECTION_ERROR` y termina con código de salida distinto de cero

#### Escenario: Token expirado sin renovación posible

- DADO que el token de acceso expiró y MSAL no puede renovarlo silenciosamente
- CUANDO el script adquiere el token
- ENTONCES el script lanza un error `GRAPH_AUTH_ERROR` y termina
