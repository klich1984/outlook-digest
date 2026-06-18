# Alertas de seguridad — Especificacion

## Proposito

Detectar correos relacionados con seguridad de cuentas entre los mensajes no leidos de Hotmail y destacarlos en el reporte semanal mediante un banner visual, asunto diferenciado y una seccion de acciones requeridas, para que el usuario pueda identificar rapidamente posibles incidentes de seguridad y tomar accion.

## Requisitos

### Requisito: Criterios de deteccion

Cada mensaje DEBE evaluarse contra tres criterios independientes combinados con OR logico. Si cualquiera de los criterios se cumple, el mensaje se marca como alerta de seguridad.

#### Criterio A: Dominio del remitente en lista de seguridad

El dominio del remitente (extraido de `from.emailAddress.address`) DEBE coincidir exactamente con alguno de los siguientes dominios de seguridad conocidos:

```
accountprotection.microsoft.com
security.microsoft.com
security@apple.com
appleid@id.apple.com
alert@paypal.com
security@paypal.com
alert@google.com
no-reply@accounts.google.com
security@linkedin.com
security@facebookmail.com
alert@twitter.com
security@instagram.com
security@dropbox.com
noreply@github.com
```

#### Criterio B: Asunto contiene palabra clave de seguridad

El asunto del mensaje DEBE contener (case-insensitive, substring match) alguna de las siguientes palabras o frases (bilingue ingles/espanol):

```
security alert
alerta de seguridad
verify your account
verifica tu cuenta
unusual sign-in
inicio de sesion inusual
suspicious activity
actividad sospechosa
password reset
restablecimiento de contrasena
account compromised
cuenta comprometida
security update
actualizacion de seguridad
new sign-in
nuevo inicio de sesion
account locked
cuenta bloqueada
unrecognized device
dispositivo no reconocido
sign-in attempt
intento de inicio de sesion
recovery code
codigo de recuperacion
two-factor authentication
autenticacion de dos factores
security breach
violacion de seguridad
```

#### Criterio C: Importancia alta

El campo `importance` del mensaje DEBE ser exactamente `"high"`.

#### Escenario: Coincide por dominio del remitente

- DADO que un correo proviene de `accountprotection.microsoft.com`
- CUANDO se evaluan los tres criterios
- ENTONCES el mensaje se marca como alerta

#### Escenario: Coincide por palabra clave en asunto

- DADO que un correo tiene el asunto "Alerta de seguridad: nuevo inicio de sesion"
- CUANDO se evaluan los tres criterios
- ENTONCES el mensaje se marca como alerta

#### Escenario: Coincide por importancia alta

- DADO que un correo tiene `importance: "high"` pero no coincide con dominio ni palabras clave
- CUANDO se evaluan los tres criterios
- ENTONCES el mensaje se marca como alerta

#### Escenario: Sin coincidencias

- DADO que un correo tiene dominio generico, asunto sin palabras clave e importancia normal
- CUANDO se evaluan los tres criterios
- ENTONCES el mensaje NO se marca como alerta

### Requisito: Marcado de alertas

Cada mensaje DEBE tener una propiedad booleana `isAlert` y un arreglo `matchedCriteria` computados despues del filtro contra checkpoint y antes de la construccion del reporte. El resultado del computo es efimero: no hay almacenamiento persistente de alertas entre ejecuciones.

#### Escenario: Coincidencia con dos criterios

- DADO que un correo coincide con el dominio Y con una palabra clave simultaneamente
- CUANDO se computa `isAlert`
- ENTONCES `isAlert = true` y `matchedCriteria` contiene las cadenas identificadoras de los dos criterios activados
- Y el mensaje aparece una sola vez en el reporte de alertas (deduplicado por message ID)

#### Escenario: Sin coincidencias

- DADO que un correo no coincide con ningun criterio
- CUANDO se computa `isAlert`
- ENTONCES `isAlert = false` y el mensaje aparece en el reporte normal sin distincion

#### Escenario: Coincidencia solo por importancia alta

- DADO que un correo tiene importancia alta pero dominio y asunto normales
- CUANDO se computa `isAlert`
- ENTONCES `isAlert = true` y `matchedCriteria = ["highImportance"]`

### Requisito: Asunto diferenciado

Cuando el reporte contenga una o mas alertas de seguridad, el asunto del correo DEBE incluir el prefijo 🚨. Cuando no haya alertas, el asunto DEBE ser el normal sin prefijo.

#### Escenario: Sin alertas

- DADO que ningun mensaje es alerta de seguridad
- CUANDO se envia el reporte
- ENTONCES el asunto es `Reporte semanal Hotmail — 17 jun 2026`

#### Escenario: Con alertas

- DADO que hay 2 alertas de seguridad
- CUANDO se envia el reporte
- ENTONCES el asunto es `🚨 Reporte semanal Hotmail — 17 jun 2026`

### Requisito: Banner HTML de alertas

El reporte HTML DEBE incluir un banner visual de color rojo en la parte superior, inmediatamente despues del resumen numerico, cuando haya una o mas alertas. El banner DEBE mostrar el numero de alertas, una lista con viñetas de los asuntos, y enlaces directos a cada mensaje en Hotmail web. Cuando no haya alertas, el banner NO DEBE incluirse.

#### Escenario: Banner con 2 alertas

- DADO que hay 2 alertas de seguridad
- CUANDO se renderiza el reporte HTML
- ENTONCES el banner muestra "⚠️ 2 alertas criticas detectadas" con dos viñetas que listan los asuntos como enlaces a `https://outlook.live.com/mail/0/inbox/id/{messageId}`

#### Escenario: Sin alertas

- DADO que no hay alertas de seguridad
- CUANDO se renderiza el reporte HTML
- ENTONCES el banner no aparece en el HTML

### Requisito: Seccion "Acciones requeridas"

El reporte HTML DEBE incluir una seccion "Acciones requeridas" entre el resumen numerico y la lista de mensajes agrupados por fecha, cuando haya una o mas alertas. Cada fila de alerta DEBE mostrar el bodyPreview completo (sin truncar). Cuando no haya alertas, la seccion NO DEBE incluirse.

#### Escenario: Sin alertas

- DADO que no hay alertas
- CUANDO se renderiza el reporte
- ENTONCES la seccion "Acciones requeridas" no aparece

#### Escenario: Una alerta

- DADO que hay 1 alerta de seguridad
- CUANDO se renderiza el reporte
- ENTONCES la seccion "Acciones requeridas" contiene una fila con bodyPreview completo, badge de importancia alta, nombre del remitente, y enlace a Hotmail web

#### Escenario: Multiples alertas

- DADO que hay 5 alertas de seguridad
- CUANDO se renderiza el reporte
- ENTONCES la seccion "Acciones requeridas" contiene 5 filas, todas con bodyPreview completo

### Requisito: Falsos positivos

El sistema NO distingue entre alertas reales de seguridad y mensajes legitimos que coinciden con los criterios por casualidad (por ejemplo, un correo de "Verify your order shipped" de un comercio electronico). Esta limitacion es deliberada: los criterios priorizan sensibilidad sobre especificidad. El usuario DEBE filtrar mentalmente los falsos positivos al revisar la seccion "Acciones requeridas".

#### Escenario: Falso positivo por coincidencia de palabra clave

- DADO que un correo de `orders@shop.example.com` tiene el asunto "Verify your order shipped"
- CUANDO se evalua el criterio de palabras clave
- ENTONCES el mensaje se marca como alerta aunque no sea de seguridad
- Y esta limitacion esta documentada; el usuario debe determinar manualmente si es una alerta real

### Requisito: Privacidad

Los mensajes marcados como alerta NO exponen campos adicionales que los mensajes normales. El bodyPreview completo (sin truncar) es la unica diferencia de contenido entre la fila de alerta y la fila normal del mismo mensaje.

#### Escenario: Sin exposicion adicional

- DADO que un mensaje normal muestra bodyPreview truncado a 240 caracteres
- CUANDO el mismo mensaje se marca como alerta
- ENTONCES el bodyPreview se muestra completo, pero no se exponen campos como `body.content`, `headers`, `attachments` ni `recipients` adicionales
