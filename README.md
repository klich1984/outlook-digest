# Mail Digest

> 🇪🇸 Estás leyendo el README en español. **[View in English →](README.en.md)**

Automatización semanal que consulta los correos no leídos de una cuenta
Hotmail (vía Microsoft Graph), construye un reporte HTML con detalle de cada
mensaje y lo entrega a una dirección Gmail configurada por el usuario. Los
correos reportados se marcan como leídos para evitar acumulación, y un
checkpoint local impide reportes duplicados si el workflow se ejecuta dos
veces el mismo día.

## Qué hace

1. Cada lunes a las 8:00 a.m. hora Colombia (UTC-5), un workflow de GitHub
   Actions se activa automáticamente.
2. El script `scripts/index.mjs` consulta Microsoft Graph por los correos
   no leídos de la bandeja de entrada recibidos en los últimos 7 días.
3. Detecta alertas de seguridad (correos de dominios conocidos, palabras
   clave de seguridad o `importance=high`) y las destaca con un banner rojo
   y una sección de acciones requeridas.
4. Construye un reporte HTML + texto plano con cada mensaje (remitente,
   asunto, fecha, importancia, adjuntos, fragmento del cuerpo).
5. Envía el reporte a la dirección Gmail configurada vía Gmail API OAuth2.
6. Marca los mensajes reportados como leídos.
7. Persiste un checkpoint con los IDs reportados y rota el cache de tokens
   MSAL para la próxima ejecución.

Si algo falla, el sistema envía un correo de error al mismo Gmail destino y
los logs de GitHub Actions quedan disponibles para diagnóstico.

## Prerrequisitos

- **Node.js 20 o superior** (probado con Node 24).
- **Una cuenta de GitHub** con permisos para crear Actions workflows y
  secrets en el repositorio destino.
- **Una cuenta personal de Hotmail / Outlook.com** (MSA). El script usa el
  tenant `consumers` de Microsoft Graph.
- **Una cuenta de Gmail** para recibir el reporte. Necesitas un proyecto
  en Google Cloud Console con Gmail API habilitada y credenciales OAuth2
  de tipo "Desktop application" (Client ID, Client Secret, Refresh Token
  con scope `gmail.send` y `access_type=offline`).

## Quick start

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env y completar las 6 variables (ver .env.example para detalles)

# 3. Vista previa sin efectos secundarios (no envía, no marca como leído)
npm run dev:dry

# 4. Ejecución local completa (envía reporte, marca mensajes, escribe
#    checkpoint en state/reported-ids.json — sin commit al repo)
npm run dev:once
```

## Estructura del proyecto

```
.
├── package.json                # type: module + scripts dev:once / dev:dry
├── .env.example                # template de variables de entorno
├── scripts/
│   ├── index.mjs               # entry point CLI (parsea --dry-run)
│   ├── build-digest.mjs        # adquisición Graph + alertas + reporte
│   └── lib/                    # módulos reutilizables
│       ├── msal.mjs
│       ├── gmail.mjs
│       ├── graph.mjs
│       ├── alerts.mjs
│       ├── checkpoint.mjs
│       ├── templates.mjs
│       ├── timezone.mjs
│       ├── logger.mjs
│       └── errors.mjs
└── openspec/changes/informe-semanal-hotmail/
    └── design.md               # arquitectura detallada
```

## Documentación adicional

- [`openspec/changes/informe-semanal-hotmail/design.md`](openspec/changes/informe-semanal-hotmail/design.md)
  — arquitectura completa, ciclo de vida del token MSAL, plantillas HTML,
  manejo de fallos y consideraciones operativas.
- [`openspec/changes/informe-semanal-hotmail/specs/`](openspec/changes/informe-semanal-hotmail/specs/)
  — especificaciones por dominio (graph-query, alerts, report, send,
    checkpoint, failure-handling, secrets, local-development).
