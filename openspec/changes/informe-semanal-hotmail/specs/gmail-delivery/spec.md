# Gmail Delivery — Especificación

## Propósito

Especificar el envío del reporte HTML al correo Gmail destino utilizando la Gmail API con OAuth2.

## Requisitos

### Requisito: Autenticación OAuth2 con googleapis

El script DEBE usar la librería `googleapis` con OAuth2, configurado con `client_id`, `client_secret` y `refresh_token` obtenidos de variables de entorno. El scope DEBE ser `https://www.googleapis.com/auth/gmail.send` con `access_type: offline`.

#### Escenario: Autenticación exitosa

- DADO que las credenciales OAuth2 son válidas
- CUANDO el script inicializa el cliente Gmail
- ENTONCES el cliente se autentica exitosamente y puede enviar mensajes

#### Escenario: Refresh token inválido o revocado

- DADO que el refresh token fue revocado (ej. cambio de contraseña)
- CUANDO el script intenta renovar el access token
- ENTONCES el script lanza `GMAIL_AUTH_ERROR` con mensaje indicando que el token debe regenerarse

### Requisito: Destino desde variable de entorno

El destinatario DEBE leerse de la variable de entorno `GMAIL_DESTINATION_ADDRESS`. No debe estar hardcodeado. Si la variable no existe, el script DEBE fallar con error claro.

#### Escenario: Variable configurada

- DADO que `GMAIL_DESTINATION_ADDRESS=usuario@gmail.com`
- CUANDO el script prepara el envío
- ENTONCES el destinatario es `usuario@gmail.com`

#### Escenario: Variable ausente

- DADO que `GMAIL_DESTINATION_ADDRESS` no está definida
- CUANDO el script inicia el envío
- ENTONCES el script falla con `GMAIL_CONFIG_ERROR` indicando la variable faltante

### Requisito: Fallo de envío aborta mark-as-read

Si el envío del reporte falla por cualquier razón (auth, red, cuota, destinatario inválido), el script NO DEBE marcar ningún mensaje como leído.

#### Escenario: Envío fallido, checkpoint preservado

- DADO que la Gmail API devuelve un error 500
- CUANDO el script detecta el error
- ENTONCES el script NO marca mensajes como leídos Y NO actualiza el checkpoint

### Requisito: Sin límite de cuota relevante

Gmail API tiene una cuota de 1 billón de unidades por día. El envío de 1-2 correos por semana está muy por debajo de este límite. No se requiere lógica de reintento.

#### Escenario: Cuota suficiente

- DADO que el workflow envía 1 correo por semana
- CUANDO se calcula la cuota consumida
- ENTONCES el consumo es despreciable frente al límite diario
