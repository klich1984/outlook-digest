# Failure Handling — Especificación

## Propósito

Especificar el manejo de fallos en cualquier etapa del workflow, garantizando que el usuario reciba notificación y que el checkpoint no se corrompa.

## Requisitos

### Requisito: Correo de error al mismo destino Gmail

Ante cualquier fallo no recuperable, el sistema DEBE enviar un correo de error al mismo `GMAIL_DESTINATION_ADDRESS` con asunto `ERROR: Reporte semanal Hotmail — {ISO timestamp}`.

#### Escenario: Error en adquisición de datos

- DADO que Graph API devuelve 401 Unauthorized
- CUANDO el script detecta el error
- ENTONCES se envía un correo con asunto `ERROR: Reporte semanal Hotmail — 2026-06-17T13:00:00.000Z`

### Requisito: Cuerpo del correo de error

El cuerpo DEBE incluir: etapa donde falló (acquisition/checkpoint/report/send/mark-read), mensaje de error, stack trace truncado a 2KB, run ID y URL de la ejecución en GitHub Actions.

#### Escenario: Contenido completo del error

- DADO que ocurrió un error en la etapa `mark-read`
- CUANDO se genera el correo de error
- ENTONCES el cuerpo contiene: `Stage: mark-read`, `Error: PATCH failed for message B`, `Stack: ...`, `Run ID: 1234`, `Run URL: https://github.com/.../actions/runs/1234`

### Requisito: El checkpoint no se corrompe

El checkpoint SOLO se escribe después de que BOTH (a) el envío del reporte sea exitoso Y (b) el marcado como leído sea exitoso. Si cualquiera falla, el checkpoint NO se actualiza.

#### Escenario: Envío exitoso pero marcado falla

- DADO que el reporte se envió exitosamente pero el PATCH para 2 mensajes falló
- CUANDO el script maneja el error
- ENTONCES el checkpoint NO se actualiza (los IDs no se persisten), y la próxima ejecución reintentará esos mensajes

### Requisito: Logs de GitHub Actions preservados

El workflow DEBE ejecutarse en `ubuntu-latest` y los logs permanecen disponibles en la interfaz de GitHub Actions. No se requiere configuración adicional de logging.

#### Escenario: Diagnóstico post-fallo

- DADO que una ejecución falló
- CUANDO el usuario revisa la pestaña Actions del repositorio
- ENTONCES puede ver la salida completa del script, incluyendo stack trace y mensajes de error
