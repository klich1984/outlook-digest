# Report — Especificación

## Propósito

Especificar la construcción del reporte HTML semanal con detalle completo de cada correo no leído, organizado por fecha descendente y remitente.

## Requisitos

### Requisito: Formato multipart/alternative

El reporte DEBE construirse como mensaje MIME `multipart/alternative` con dos partes: texto HTML (principal) y texto plano (fallback para lectores de correo sin HTML).

#### Escenario: Renderizado en cliente de correo moderno

- DADO que el reporte se envía como multipart/alternative
- CUANDO Gmail recibe el mensaje
- ENTONCES Gmail muestra la parte HTML

### Requisito: Encabezado del reporte

El encabezado DEBE incluir: cuenta de Hotmail (origen, leída de la variable de entorno `HOTMAIL_ACCOUNT_ADDRESS`), rango de fechas en zona COL, total de correos, y desglose focused/other.

#### Escenario: Vista general

- DADO que hay 12 correos (8 focused, 4 other)
- CUANDO el reporte se genera
- ENTONCES el encabezado muestra: "12 correos no leídos (8 Prioritarios, 4 Otros)"

### Requisito: Agrupación por fecha descendente y remitente

Los correos DEBEN agruparse por fecha descendente (más reciente primero) y dentro de cada día por remitente alfabéticamente.

#### Escenario: Organización temporal

- DADO que hay correos del 15, 16 y 17 de junio
- CUANDO el reporte se genera
- ENTONCES la sección del 17 de junio aparece primero, luego 16, luego 15

### Requisito: Detalle por correo (bodyPreview incluido)

Cada fila DEBE incluir: nombre y dirección del remitente (con enlace `mailto:`), asunto, `receivedDateTime` en zona horaria COL, badge de importancia (alta/normal/baja), badge de adjuntos, etiqueta focused/other, y enlace al mensaje en Hotmail web.

El `bodyPreview` DEBE truncarse a 240 caracteres para filas normales. Los mensajes marcados como alerta de seguridad DEBEN mostrar el `bodyPreview` completo (sin truncar). La logica de deteccion de alertas se especifica en `specs/security-alerts/spec.md`.

#### Escenario: Fila normal con bodyPreview truncado

- DADO un correo de "Juan Pérez" con asunto "Reunión" e importancia alta, sin alerta de seguridad
- CUANDO se renderiza la fila
- ENTONCES la fila incluye el bodyPreview truncado a 240 caracteres y un enlace `https://outlook.live.com/mail/0/inbox/id/{id}`

#### Escenario: Fila de alerta con bodyPreview completo

- DADO un correo marcado como alerta de seguridad
- CUANDO se renderiza la fila en la seccion "Acciones requeridas"
- ENTONCES el bodyPreview se muestra completo (sin truncar)

### Requisito: Línea de asunto del mensaje

El asunto del correo DEBE seguir el formato `Reporte semanal Hotmail — {DD MMM YYYY}` en zona horaria COL (UTC-5). Cuando el reporte contenga una o mas alertas de seguridad, el asunto DEBE incluir el prefijo 🚨. La logica de decision del prefijo se especifica en `specs/security-alerts/spec.md`.

#### Escenario: Asunto sin alertas

- DADO que la ejecucion es el lunes 2026-06-17 a las 13:00 UTC (08:00 COL) y no hay alertas de seguridad
- CUANDO se envia el correo
- ENTONCES el asunto es `Reporte semanal Hotmail — 17 jun 2026`

#### Escenario: Asunto con alertas

- DADO que hay 3 alertas de seguridad
- CUANDO se envia el correo
- ENTONCES el asunto es `🚨 Reporte semanal Hotmail — 17 jun 2026`

### Requisito: Pie de página con IDs auditables

El reporte DEBE incluir un pie de página con la lista completa de IDs de mensajes procesados.

#### Escenario: Auditoría de mensajes

- DADO que se procesaron 5 mensajes
- CUANDO se genera el reporte
- ENTONCES el pie de página lista los 5 IDs en formato legible

### Requisito: Seccion de alertas de seguridad

El reporte DEBE incluir contenido adicional cuando se detecten una o mas alertas de seguridad: banner visual rojo, asunto con prefijo 🚨, y seccion "Acciones requeridas" con detalle completo. La especificacion completa de deteccion, marcado y renderizado de alertas esta en `specs/security-alerts/spec.md`.

### Requisito: Decisión sobre bodyPreview

Se recomienda INCLUIR `bodyPreview` truncado a 240 caracteres. El usuario solicita "detalle completo" de cada correo, y la privacidad está mitigada porque el reporte viaja exclusivamente al Gmail del propio usuario.

#### Escenario: Privacidad mitigada

- DADO que el reporte se envía solo a la dirección configurada por el usuario
- CUANDO se incluye bodyPreview
- ENTONCES no hay exposición a terceros
