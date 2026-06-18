# Checkpoint — Especificación

## Propósito

Especificar el mecanismo de idempotencia que evita reportar y marcar como leídos los mismos correos en ejecuciones repetidas del workflow.

## Requisitos

### Requisito: Formato del archivo checkpoint

El archivo `state/reported-ids.json` DEBE usar el siguiente esquema:

```json
{
  "version": 1,
  "lastRunAt": "2026-06-17T13:00:00.000Z",
  "reportedIds": [
    { "id": "AAMkAD...", "reportedAt": "2026-06-17T13:05:00.000Z" }
  ]
}
```

#### Escenario: Archivo creado correctamente

- DADO que el checkpoint se escribe al finalizar la ejecución
- CUANDO se inspecciona `state/reported-ids.json`
- ENTONCES el archivo ES un JSON válido con los campos `version`, `lastRunAt` y `reportedIds`

### Requisito: Creación automática si no existe

Si `state/reported-ids.json` no existe al inicio de la ejecución, el sistema DEBE crearlo con `{ version: 1, lastRunAt: null, reportedIds: [] }`.

#### Escenario: Primera ejecución

- DADO que no existe `state/reported-ids.json`
- CUANDO el script inicia
- ENTONCES el script crea el archivo con `reportedIds` vacío y continúa

### Requisito: Exclusión de IDs ya reportados

Antes de construir el reporte, el script DEBE filtrar los mensajes obtenidos de Graph excluyendo aquellos cuyo `id` aparezca en `reportedIds`.

#### Escenario: Ejecución duplicada el mismo día

- DADO que una ejecución previa ya reportó 3 mensajes (ids A, B, C)
- CUANDO una segunda ejecución encuentra los mismos 3 mensajes más 1 nuevo (D)
- ENTONCES el reporte solo incluye el mensaje D

### Requisito: Commit del checkpoint al finalizar

El workflow DEBE hacer commit y push de `state/reported-ids.json` después de marcar los mensajes como leídos. El mensaje de commit DEBE contener `[skip ci]` para evitar que el propio workflow se dispare recursivamente.

#### Escenario: Commit exitoso

- DADO que el checkpoint fue actualizado con nuevos IDs
- CUANDO el script completa mark-as-read exitosamente
- ENTONCES el workflow ejecuta `git add state/reported-ids.json && git commit -m "checkpoint: ... [skip ci]" && git push`

### Requisito: Ejecuciones concurrentes no soportadas

Los workflows de GitHub Actions sobre un mismo repositorio son secuenciales por diseño (`concurrency` group o falta de solapamiento natural). No se requiere lógica de locking.

#### Escenario: Ejecución secuencial

- DADO que el workflow se ejecuta una vez por semana
- CUANDO se programa para lunes 13:00 UTC
- ENTONCES no hay riesgo de ejecución concurrente
