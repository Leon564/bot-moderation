# moderabot

Bot moderador automático para el chat en `E:\Dev\chat\backend`. Se autentica
como usuario con rol `bot`, escucha el socket.io del backend, modera mensajes
con un LLM (compatible con OpenAI / DeepSeek / OpenRouter), aplica acciones
(eliminar mensaje, banear) y mantiene un sistema de strikes acumulativos.

Origen: este proyecto fue una migración del bot moderador para `cbox.ws`. La
arquitectura ahora apunta al backend nuevo del chat. Toda referencia a CBOX,
WebSocket directo a cbox, login por scraping HTML, etc., fue removida.

---

## Arquitectura

```
                     ┌──────────────────┐
                     │  chat backend    │
                     │  (NestJS + ws)   │
                     └────────┬─────────┘
                              │ socket.io  /api/auth/bot
                              ▼
        ┌─────────────────────────────────────┐
        │             moderabot               │
        │                                     │
        │  ChatSocketService ◀── handshake    │
        │       │                             │
        │       │ newMessage                  │
        │       ▼                             │
        │  BotService.handleMessage           │
        │       │                             │
        │       ├─ pre-filter (regex/spam)    │
        │       │                             │
        │       ├─ ModerationService          │
        │       │     └─ LLM (deepseek/gpt)   │
        │       │                             │
        │       └─ acción:                    │
        │           sendMessage / delete /    │
        │           banUser  + recordStrike   │
        └─────────────────────────────────────┘
```

### Módulos

| Path | Responsabilidad |
|---|---|
| `src/modules/chat-socket/` | Handshake con `/api/auth/bot`, conexión socket.io, helpers `sendMessage` / `sendMessageAndAwaitId` / `deleteMessage` / `banUser` |
| `src/modules/chat/messages.service.ts` | Wrapper delgado sobre ChatSocketService |
| `src/modules/chat/moderation.service.ts` | Pre-filtro determinístico + LLM + parseo de respuesta + detección de info personal |
| `src/modules/bot/bot.service.ts` | Orquestación: recibe, modera, aplica acción, gestiona strikes y comandos GPT (`pausa moderación`, etc.) |
| `src/common/utils/logging.service.ts` | Persistencia simple de logs en `data/messages_log.json` |

---

## Pipeline de moderación

Por cada mensaje entrante (de roles `guest`/`user`; mods/admins/bots se saltean):

1. **Pre-filtros determinísticos** (sin LLM, microsegundos):
   - 6+ caracteres consecutivos iguales (`AAAAAA`, `------`) → spam.
   - 5+ chars sin ninguna letra (`!!!!!!`) → spam.
   - Mensaje idéntico al anterior del mismo user en los últimos 60s → spam.
   - Slur en hard-blocklist (`maricón`, `imbecil`, `subnormal`, etc.) → hate speech.
2. **Normalización anti-evasión** antes del pre-filtro:
   - Confusables Unicode (cirílico/griego que parecen latinos) → latino.
   - Leetspeak entre letras (`imbec1l` → `imbecil`).
   - Espaciado evasivo (`p u t o` → `puto`) cuando hay 4+ letras sueltas seguidas.
3. **Detección de info personal** (regex + LLM contextual): teléfonos, emails, redes sociales compartidas con intención de contacto externo.
4. **LLM** con prompt corto, en tono "moderador humano", y un *tone* por modo (`STRICT`/`MODERATE`/`LENIENT`/`PRIVACY_ONLY`). Devuelve JSON `{ allowed, severity, reason, category, action }`.
5. **Acción**:
   - `allow` → no hace nada.
   - `warn` → mensaje de advertencia público (auto-eliminado a los 10s).
   - `timeout` → elimina el mensaje + warning.
   - `ban` → elimina + ban temporal vía `moderateBan`.

---

## Sistema de strikes

Cuenta advertencias acumulativas por usuario. Al alcanzar el umbral, dispara
un ban temporal automático.

- Solo cuentan las advertencias cuya `severity` coincide con
  `STRIKE_COUNT_SEVERITY` (default `medium`, que cubre spam y graves).
- El contador se resetea automáticamente:
  - al banear (vuelve a 0 tras la sanción), o
  - si pasa la ventana `STRIKE_WINDOW_HOURS` sin nuevas infracciones.
- En cada warning normal, el bot agrega `(N/M advertencias)` para que el user
  sepa que está escalando.
- Al alcanzar el umbral se publica:
  `🔨 user: Ban temporal (5m) por acumular 3 advertencias graves.`

Los strikes viven en memoria (Map) — se pierden al reiniciar el proceso. Si
querés persistencia, sería trabajo de Fase 1 del roadmap (migración a Mongo).

---

## Comandos en el chat (solo mod/admin/superAdmin)

El bot interpreta lenguaje natural via LLM, no un parser estricto. Ejemplos
que entiende:

| Mensaje | Acción |
|---|---|
| `pausa la moderación 30 minutos` | Pausa el flujo de moderación 30 min. |
| `desactiva el bot 2 horas` | Pausa 2 horas. |
| `pausa el mod 1 día` | Pausa 1 día. |
| `reanuda la moderación` | Reactiva inmediatamente. |
| `cómo está el bot?` | Reporta estado y tiempo restante. |

La pausa expira sola; tras ese tiempo el bot anuncia la reanudación.

---

## Variables de entorno (`.env`)

```bash
# OpenAI / proveedor compatible
OPENAI_API_KEY = sk-...
OPENAI_BASE_URL = https://api.deepseek.com   # o https://api.openai.com/v1
OPENAI_MODEL = deepseek-chat                 # o gpt-4o-mini

# Prefijo de color para mensajes públicos del bot
TEXT_COLOR = 3ca6ec

# Conexión al backend del chat
CHAT_API_URL = http://localhost:3001
CHAT_API_KEY = <generada en panel Admin → Bots>

# Moderación automática
MODERATION_ENABLED = true              # activa el LLM
AUTO_MODERATE_ALL = true               # modera todos los mensajes (excepto mods/admins/bots)
AUTO_DELETE_MESSAGES = true            # elimina el mensaje en timeout/ban
SEND_MODERATION_WARNINGS = true        # publica advertencia en el chat
PERSONAL_INFO_PROTECTION = true        # bloquea info personal compartida

MODERATION_LEVEL = MODERATE            # STRICT / MODERATE / LENIENT / PRIVACY_ONLY

# Strikes
STRIKES_BEFORE_BAN = 3
STRIKE_BAN_DURATION = 5m               # 5m / 1h / 1d / 1w / permanent
STRIKE_WINDOW_HOURS = 24
STRIKE_COUNT_SEVERITY = medium         # medium (spam + graves) / high / all
```

### Niveles de severidad

| Nivel | Comportamiento |
|---|---|
| `STRICT` | Modera ante la duda. Cero tolerancia a insultos y groserías agresivas. |
| `MODERATE` | Equilibrado. Modera lo claramente ofensivo y spam. Permite lenguaje fuerte casual. |
| `LENIENT` | Permisivo. Solo bloquea hate speech, amenazas, insultos directos extremos y spam. |
| `PRIVACY_ONLY` | No modera contenido conversacional; solo info personal y spam. |

---

## Pre-requisitos en el backend del chat

Esta config la hace una sola vez un admin del chat:

1. Panel admin → **Bots** → crear usuario con username (ej. `ModeraBot`) y rol `bot`.
2. Generar API key para ese bot.
3. Pegarla en `moderabot/.env` como `CHAT_API_KEY`.

El backend ya soporta el rol `bot` en `joinChat`, `sendMessage`, `deleteMessage` y `moderateBan`. No requiere cambios.

Limitación del rol `bot` en la gateway: solo puede borrar/banear a `guest` y `user`. Mods/admins son inmunes — esto es intencional y consistente con el chequeo en `bot.service.ts` que también saltea moderar a esos roles.

---

## Cómo correr

```bash
cd moderabot
pnpm install
cp .env.example .env   # editar y poner las claves reales
pnpm start:dev          # modo watch
# o
pnpm start:prod         # PM2
```

Logs esperados al arrancar:

```
✅ Authenticated as bot: ModeraBot
🔌 Connected to chat socket
🤖 Joined chat as ModeraBot
🛡️ Nivel de moderación: MODERATE
```

---

## Roadmap

Fases siguientes (ver fases de F0 ya ejecutada arriba):

- **F1 — Persistencia y robustez**: migrar `data/*.json` y strikes a MongoDB. Reconexión exponencial. Circuit breaker en el LLM.
- **F2 — Moderación más fina**: bans escalonados (5m → 1h → 1d), whitelist runtime, cache LRU de decisiones, reputación implícita por días sin strike.
- **F3 — Observabilidad y panel**: endpoint `/health`, métricas, settings runtime en Mongo, pestaña "Moderador" en el panel admin del chat.
- **F4 — UX para mods**: `!mod history|undo|warn|whitelist`, notificación DM a admins en bans, memoria corta de conflictos.
- **F5 — Tests y cleanup**: unit tests de pre-filtro, role mapping, strikes con clock mock.
