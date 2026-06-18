# Mark-as-Read — Especificación

## Propósito

Especificar el marcado como leído de los mensajes incluidos en el reporte, utilizando Microsoft Graph API con scope `Mail.ReadWrite`.

## Requisitos

### Requisito: Marcado uno por uno (o batch de hasta 20)

El script DEBE ejecutar `PATCH /me/messages/{id}` con body `{ isRead: true }` para cada mensaje reportado. OPCIONALMENTE puede usar `$batch` para agrupar hasta 20 operaciones por request.

#### Escenario: Marcado exitoso de 3 mensajes

- DADO que el reporte incluye 3 mensajes con ids A, B, C
- CUANDO el script ejecuta los PATCH
- ENTONCES cada mensaje queda con `isRead: true`

#### Escenario: Batch de 20 mensajes

- DADO que hay 25 mensajes para marcar
- CUANDO el script usa `$batch`
- ENTONCES se envían 2 batches (20 + 5) y todos los mensajes quedan como leídos

### Requisito: Fallo parcial no bloquea el resto

Si un PATCH falla para un mensaje específico (ej. el ID ya no existe), el script DEBE registrar el fallo, continuar con los demás, e incluir la lista de IDs fallidos en el reporte de error.

#### Escenario: Un mensaje ya no existe

- DADO que el mensaje con id B fue eliminado antes del marcado
- CUANDO el script intenta PATCH B
- ENTONCES el script registra B como fallido, continúa con A y C, y el reporte de error incluye B en la lista

### Requisito: Alcance Mail.ReadWrite separado del de lectura

La lectura usa scope `Mail.Read`. El marcado como leído usa `Mail.ReadWrite`. El script DEBE solicitar ambos scopes al inicializar MSAL.

#### Escenario: Adquisición de token con scopes combinados

- DADO que MSAL se inicializa con scopes `["Mail.Read", "Mail.ReadWrite", "offline_access"]`
- CUANDO se adquiere el token
- ENTONCES el token incluye permisos para leer y escribir mensajes
