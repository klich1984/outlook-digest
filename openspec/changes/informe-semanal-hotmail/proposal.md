# Propuesta: Informe Semanal de Hotmail

## Contexto y motivación

El usuario tiene una cuenta de Hotmail (dirección personal, almacenada como `HOTMAIL_ACCOUNT_ADDRESS` y nunca escrita en código) que no revisa con regularidad. Como resultado, correos importantes pueden pasar desapercibidos durante días o semanas. Se necesita una automatización semanal que:

1. Consulte la bandeja de entrada de Hotmail
2. Genere un reporte estructurado con todos los correos no leídos de los últimos 7 días
3. Envíe ese reporte a un Gmail que el usuario revisa frecuentemente
4. Marque los correos reportados como leídos para evitar acumulación

El objetivo es mantener visibilidad sobre la bandeja de Hotmail sin tener que abrirla, detectando rápidamente si hay algo urgente que atender.

## Alcance

### In Scope

1. **Consulta de correos**: Leer correos no leídos de los últimos 7 días desde la bandeja de entrada de Hotmail vía Microsoft Graph API
2. **Generación de reporte HTML**: Construir un reporte con detalle completo de CADA correo (remitente, asunto, fecha, importancia, adjuntos), organizado por remitente y por fecha
3. **Envío a Gmail**: Entregar el reporte por correo electrónico a una dirección Gmail configurada por el usuario (vía Gmail API + OAuth2)
4. **Marcar como leídos**: Los correos incluidos en el reporte se marcan como leídos (`PATCH isRead=true`)
5. **Tolerancia a fallos**: Si algo falla, se envía un segundo correo de error al mismo Gmail, y los logs de GitHub Actions quedan disponibles para diagnóstico
6. **Programación**: Ejecución automática cada lunes a las 8:00 a.m. hora Colombia (UTC-5), más activación manual vía `workflow_dispatch`
7. **Idempotencia**: Si el workflow se ejecuta dos veces el mismo día, la segunda ejecución no encuentra correos nuevos (ya marcados como leídos) y no envía reporte duplicado

### Fuera de Alcance (Non-Goals)

- Eliminar spam o correos no deseados
- Auto-responder correos
- Mover correos a carpetas
- Enviar el reporte a múltiples direcciones Gmail
- Reenviar adjuntos
- Filtrar por importancia, remitente, tipo, o presencia de adjuntos
- Interfaz de usuario o dashboard
- Integración con otros servicios (Slack, Teams, etc.)

## Decisiones de Producto

1. **Cadencia**: Cada lunes a las 8:00 a.m. hora Colombia (UTC-5). También activable manualmente con `workflow_dispatch` para pruebas.
2. **Nivel de detalle**: Reporte con detalle COMPLETO de cada correo, organizado por remitente y por fecha. No es un resumen agregado.
3. **Filtro de importancia**: NINGUNO. Se incluyen TODOS los correos de los últimos 7 días sin filtrar por focused/other, adjuntos, o remitente.
4. **Manejo de fallos**: AMBOS — (a) correo de error enviado al mismo Gmail destino para notificar al usuario sin depender de GitHub, y (b) logs de ejecución preservados en GitHub Actions para diagnóstico.
5. **Límite del alcance**: Únicamente "construir reporte + marcar como leídos". Excluye eliminar spam, auto-responder, mover a carpetas, enviar a múltiples destinos, o reenviar adjuntos.

## Decisiones Técnicas

| Decisión | Opción Elegida | Justificación |
|----------|----------------|---------------|
| Plataforma de ejecución | GitHub Actions (`ubuntu-latest`) | Sin costo, cron declarativo en YAML, `workflow_dispatch` para pruebas, sin infraestructura propia |
| Entrega del reporte | Gmail API + OAuth2 | El usuario confirmó "Camino A". Más robusto que App Password, sin depender de 2FA estático |
| Autenticación Hotmail | MSAL Node con token cache serializado como GH secret | El script se autentica directamente con Microsoft, no pasa por OpenCode. El token se genera localmente y se almacena como secreto |
| Tenant | `consumers` | Cuenta personal de Microsoft (MSA), no corporativa |
| Perfil de OpenCode | Se mantiene `--read-only` en el perfil interactivo existente | El workflow programado usa su propia autenticación MSAL, no el MCP de OpenCode |
| Zona horaria | Cron `0 13 * * 1` (13:00 UTC = 8:00 COL UTC-5) | GitHub Actions siempre corre en UTC. El desplazamiento se documenta explícitamente |
| Lenguaje | Node.js ESM (`type: module`) | Sin bundler necesario, compatible con `@azure/msal-node` y `googleapis` |

## Decisiones Pendientes (para spec y design)

1. **Estructura HTML exacta del reporte**: ¿Incluir el cuerpo del mensaje (bodyPreview) en línea, o solo remitente + asunto + fecha + enlace a Hotmail web? El explore sugería omitir body completo por privacidad; la decisión de producto "detalle completo" podría implicar incluirlo. Se resuelve en spec.
2. **Plantilla del correo de error**: ¿Qué información incluir (mensaje de error, stack trace, HTTP status, sugerencias)? Se define en spec.
3. **Rotación del token cache**: ¿Usar `gh secret set` dentro del workflow, o una aproximación más simple (ej. gist, o simplemente regenerar manualmente cuando expire)? Se define en design.
4. **Nombre del workflow**: `weekly-digest.yml` vs `informe-semanal.yml` — se prefiere inglés para consistencia con convenciones del proyecto.
5. **Manejo de rate limiting de Gmail API**: Gmail tiene cuota de 1 billón de unidades/día, el envío de 1-2 correos por semana está muy por debajo. No se necesita lógica adicional, pero se documenta.

## Criterios de Éxito

- [ ] El workflow se ejecuta automáticamente cada lunes a las 8:00 a.m. hora Colombia
- [ ] Un reporte HTML completo llega al Gmail destino con el total de correos no leídos de la semana
- [ ] Cada correo en el reporte incluye remitente, asunto, fecha, indicador de importancia, indicador de adjuntos
- [ ] Los correos reportados aparecen como leídos en Hotmail después de la ejecución
- [ ] Si ocurre cualquier fallo, un correo de error legible llega al mismo Gmail destino
- [ ] `workflow_dispatch` se puede activar manualmente para pruebas sin esperar al lunes
- [ ] Ejecutar dos veces el mismo día no produce reportes duplicados

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Token MSAL expira en GH Actions sin rotarse | Media | Alto — el workflow deja de funcionar | Script post-ejecución que serializa el cache actualizado y lo persiste; documentar regeneración manual como fallback |
| Inactividad del repositorio (>60 días) desactiva el schedule | Baja | Medio — el reporte deja de llegar silenciosamente | Documentar que el usuario debe re-activar manualmente; considerar heartbeat bimensual opcional |
| Privacidad del reporte (contiene datos personales) | Media | Medio — el reporte viaja a Gmail externo | No incluir bodyPreview a menos que el usuario lo solicite explícitamente; solo asunto + remitente + fecha + enlace |
| Cache de GH Actions se pierde (checkpoint) | Baja | Bajo — posible re-inclusión de correos ya reportados | El filtro `receivedDateTime` de 7 días limita la ventana de re-inclusión |
| Rate limiting de Microsoft Graph | Muy Baja | Bajo — la ejecución usa ~100 requests, muy por debajo del límite de 10k/10min | Documentado, no requiere manejo especial |
| Token Gmail OAuth2 expira (refresh token revocado) | Baja | Medio — el envío falla | `offline_access` scope con refresh token; documentar regeneración manual |

## Estructura del Proyecto Propuesta

```
mcp/
├── opencode.json                          # Existente, sin cambios para uso interactivo
├── .github/
│   └── workflows/
│       └── weekly-digest.yml              # Cron + workflow_dispatch
├── scripts/
│   ├── build-digest.mjs                   # Graph query → reporte HTML
│   ├── send-gmail.mjs                     # Envío vía Gmail API
│   ├── mark-read.mjs                      # PATCH isRead=true
│   ├── error-report.mjs                   # Notificación de fallo
│   └── lib/
│       ├── msal.mjs                       # MSAL Node: token loading + refresh
│       └── gmail.mjs                      # Cliente Gmail API reutilizable
├── .env.example                           # Template para pruebas locales
├── .gitignore                             # .env, node_modules, .cache
├── package.json                           # type: module, scripts locales
├── README.md                              # Setup, test local, despliegue
└── openspec/
    └── changes/
        └── informe-semanal-hotmail/
            ├── proposal.md                ← Este archivo
            ├── specs/                     # Fase sdd-spec
            ├── design.md                  # Fase sdd-design
            └── tasks.md                   # Fase sdd-tasks
```

## Fases Siguientes

1. **sdd-spec**: Definir requerimientos detallados (escenarios: éxito, fallo, ejecución manual, idempotencia) y validar decisiones pendientes con el usuario
2. **sdd-design**: Arquitectura detallada, diagrama de flujo del workflow, estructura del token cache, plantillas HTML
3. **sdd-tasks**: Dividir en tareas de implementación con estimación y dependencias
4. **sdd-apply**: Implementar cada tarea
5. **sdd-verify**: Probar end-to-end con ejecución real (workflow_dispatch)
6. **sdd-archive**: Sincronizar deltas y documentar

## Nota sobre el perfil de OpenCode

El perfil interactivo existente en `opencode.json` usa `--read-only` y NO se modifica. El workflow programado ejecuta scripts Node.js independientes que se autentican directamente con Microsoft (MSAL Node), no a través del MCP server de OpenCode. Esta separación es intencional: el flujo programado necesita `Mail.ReadWrite` para marcar como leídos, mientras que el perfil interactivo permanece en solo lectura por decisión del usuario.
