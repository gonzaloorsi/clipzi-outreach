# clipzi-outreach

Herramienta para encontrar canales de YouTube en LATAM, extraer emails de contacto y enviar outreach personalizado para [Clipzi](https://clipzi.app).

## Setup

1. Clonar el repo
2. Copiar `.env.example` a `.env` y completar las API keys:
   ```bash
   cp .env.example .env
   ```
3. Configurar las variables:
   - `YOUTUBE_API_KEY` — API key de YouTube Data API v3
   - `RESEND_API_KEY` — API key de [Resend](https://resend.com)
   - `SENDER_EMAIL` — Email del remitente (ej: `g@clipzi.dev`)
   - `SENDER_NAME` — Nombre del remitente

## Scripts

| Comando | Script | Descripción |
|---------|--------|-------------|
| `npm run fetch` | `fetch-channels.mjs` | Busca canales argentinos en YouTube API y genera CSV inicial |
| `npm run refine` | `refine-channels.mjs` | Refina la lista buscando más canales y filtrando estrictamente por `country=AR` |
| `npm run filter` | `filter-local.mjs` | Filtra localmente (sin API) los canales ya descargados → genera `*_FINAL.csv/json` |
| `npm run build` | `build-final.mjs` | Genera la lista final consolidada LATAM → `top100_latam_youtube_FINAL.csv/json` |
| `npm run fetch:batch2` | `fetch_batch2.mjs` | Busca nuevos canales LATAM evitando duplicados con batch 1 |
| `npm run send` | `send-emails.mjs` | Envía emails personalizados vía Resend a los canales con email |

### Flujo típico

```
fetch → refine → filter → build → send
```

## Archivos de datos

| Archivo | Contenido |
|---------|-----------|
| `top100_argentina_youtube.csv` | Datos crudos de la primera búsqueda (Argentina) |
| `top100_argentina_youtube_FINAL.csv/json` | Lista filtrada de canales argentinos |
| `top100_latam_youtube_FINAL.csv/json` | Lista final consolidada LATAM (usada para envío) |
| `send_results.json` | Resultados del envío de emails (status, IDs) |
| `email_template.md` | Template de referencia del email |

## Estado actual

- **Batch 1**: ✅ Enviado — 38 emails a 37 canales
- **Batch 2**: ⏳ Pendiente — se necesita reset de quota de YouTube API
