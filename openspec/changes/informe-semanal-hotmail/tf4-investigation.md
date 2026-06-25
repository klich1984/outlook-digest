# TF-4: Gmail MCP Investigation — Conclusiones

**Fecha:** 2026-06-25
**Investigador:** carlos_usuga
**Rama:** `feat/mcp-gmail-api-investigation`
**Status:** ❌ NO VIABLE — cerrado

## TL;DR

El servidor de MCP de Gmail (https://developers.google.com/workspace/gmail/api/reference/mcp) **NO soporta envío de emails**. Solo expone 10 herramientas para lectura y organización (drafts, labels, threads, search). No es una alternativa válida para nuestro caso de uso (envío semanal de reporte).

Adicionalmente, **el MCP usa OAuth2 tradicional de Google Cloud**, así que NO bypassea el Programa de Protección Avanzada (APP) de Google. Las cuentas con APP activado seguirían bloqueando este MCP server.

## Hallazgos detallados

### Herramientas disponibles (10)

```
- create_draft       (crear borrador, NO envía)
- create_label       (crear label)
- get_thread         (leer thread)
- label_message      (etiquetar mensaje)
- label_thread       (etiquetar thread)
- list_drafts        (listar borradores)
- list_labels        (listar labels)
- search_threads     (buscar threads)
- unlabel_message    (quitar label)
- unlabel_thread     (quitar label)
```

### Herramientas que NO existen

- ❌ `send_message` o equivalente
- ❌ `send_draft` (no hay forma de enviar un draft creado)
- ❌ Cualquier acción que modifique la bandeja de salida del usuario

### Status del producto

- "Developer Preview Program" — no es GA
- Última actualización de la doc: 2026-05-13
- Endpoint global: `https://gmailmcp.googleapis.com/mcp/v1`
- Pensado para LLMs que necesitan leer y organizar Gmail, no enviar

### Autenticación

OAuth2 tradicional de Google Cloud (no hay bypass de APP). Las cuentas
con APP activado siguen bloqueando el MCP server igual que cualquier
otra API de Google.

## Conclusión

Este enfoque **no resuelve nuestro problema**: necesitamos enviar emails,
no leerlos. El MCP de Gmail está pensado para casos de uso diferentes
(agentes de IA que ayudan al usuario a organizar su inbox).

## Próximas alternativas a explorar (futuro)

Si en el futuro queremos volver a intentar usar la cuenta principal
(`carlosusugamartinez@gmail.com` con APP), las opciones serían:

1. **Apps Script como proxy** — publicar un web app que use
   `MailApp.sendEmail()` corre en infraestructura de Google y APP no
   lo bloquea. Requiere deployment adicional.

2. **Servicios de email de terceros** — SendGrid, Mailgun, AWS SES.
   APP no aplica porque no es Gmail.

3. **Forwarding avanzado** — ya implementado como TF-3 (funciona).
   Mantener la cuenta secundaria + forward es el approach más simple.

## Referencias

- Doc oficial: https://developers.google.com/workspace/gmail/api/reference/mcp?hl=es_419
- Programa de preview: https://developers.google.com/workspace/preview?hl=es_419
- Apps Script MailApp: https://developers.google.com/apps-script/reference/gmail/mail-app