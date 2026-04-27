# 🛡️ Bot Moderador Puro

Este bot ha sido simplificado para funcionar **únicamente como moderador automático**, sin capacidades de chat, comandos o respuestas interactivas.

## 🎯 Funcionalidad Exclusiva

### ✅ Lo que SÍ hace:
- **Moderación automática de todos los mensajes** usando GPT-4o-mini
- **Eliminación automática de contenido inapropiado** (insultos, spam, amenazas)
- **Advertencias educativas** para usuarios que violan las normas
- **Logging completo** de toda la actividad de moderación
- **Renovación automática de sesión** para funcionamiento continuo

### ❌ Lo que NO hace:
- No responde a comandos de música (`!play`, `!search`)
- No responde a solicitudes de usuarios online
- No genera respuestas de ChatGPT
- No maneja comandos de debug
- No participa en conversaciones normales
- No genera resúmenes de chat

## ⚙️ Configuración

### Variables de Entorno Principales
```env
# Configuración básica del bot
CBOX_URL = https://www.cbox.ws/your-chat
CBOX_USERNAME = ModeratorBot
CBOX_PASSWORD = your-password

# Configuración de moderación
MODERATION_ENABLED = true              # Activar moderación con GPT-4o-mini
AUTO_MODERATE_ALL = true               # Moderar TODOS los mensajes
AUTO_DELETE_MESSAGES = true            # Eliminar mensajes automáticamente
SEND_MODERATION_WARNINGS = true        # Enviar advertencias públicas

# API de OpenAI (requerida para moderación)
OPENAI_API_KEY = sk-your-api-key

# Configuración opcional
TEXT_COLOR = ff0000                     # Color de las advertencias (hex)
```

### Modos de Operación
```env
# Modo 1: Moderador completo (por defecto)
SEND_MODERATION_WARNINGS = true        # Elimina + Advierte públicamente

# Modo 2: Moderador silencioso
SEND_MODERATION_WARNINGS = false       # Solo elimina, no advierte
```

## 🛠️ Comportamiento Detallado

### Flujo de Moderación
1. **Recibe mensaje** → Analiza con GPT-4o-mini
2. **Contenido inapropiado detectado** → Clasifica severidad
3. **Acción automática:**
   - `warn` + toxicidad → Elimina mensaje + Advertencia
   - `timeout` → Elimina mensaje + Advertencia
   - `ban` → Elimina mensaje + Advertencia severa

### Criterios de Moderación
- ✅ **Moderación estricta:** Insultos directos, spam evidente, amenazas, discriminación
- ✅ **Moderación permisiva:** Conversaciones normales, mensajes cortos, opiniones fuertes pero respetuosas

### Logs de Actividad
```
🛡️ [AUTO-MOD] Moderando mensaje de Usuario...
🚫 [MOD] Mensaje bloqueado de Usuario: Insulto directo
🗑️ [MOD] Intentando eliminar mensaje 12345 (timeout)
⚠️ Usuario: Mensaje eliminado - Insulto directo. Por favor, mantén el respeto en el chat.
✅ [MOD] Mensaje aprobado de UsuarioRespetuoso
```

## 🔧 Características Técnicas

### Dependencias Mínimas
- **AuthService**: Manejo de sesiones y autenticación
- **MessagesService**: Envío y eliminación de mensajes
- **ModerationService**: Análisis con GPT-4o-mini
- **LoggingService**: Registro de actividad

### Gestión de Sesión
- **Renovación automática** cada 10 minutos
- **Verificación antes de cada acción** de moderación
- **Reconexión automática** en caso de desconexión

### Rendimiento
- **Sin cola de respuestas**: Envío directo de advertencias
- **Procesamiento mínimo**: Solo moderación, sin análisis de comandos
- **Bajo consumo**: Sin servicios de música, memoria o utilidades

## 📊 Monitoreo

### Logs de Inicio
```
🛡️ Inicializando Moderador Bot Service...
✅ Bot moderador iniciado como ModeratorBot
🛡️ Moderación automática: ENABLED
🗑️ Eliminación automática: ENABLED
⚠️ Advertencias públicas: ENABLED
🔌 Conexión WebSocket abierta - Moderador activo
```

### Estadísticas en Tiempo Real
- Total de mensajes analizados
- Mensajes bloqueados por categoría
- Advertencias enviadas
- Sesiones renovadas
- Errores de conexión

## 🚀 Despliegue

### Instalación
```bash
npm install
cp .env.example .env
# Configurar variables de entorno
npm run build
npm run start:prod
```

### Docker (Recomendado)
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY . .
RUN npm ci --only=production
CMD ["npm", "run", "start:prod"]
```

### Monitoreo de Salud
- **Renovación automática de sesión**: Cada 10 minutos
- **Reconexión WebSocket**: Automática en caso de fallo
- **Reintentos de inicio**: Cada 30 segundos si falla

## 🎯 Casos de Uso

### Chat Comunitario
- **Moderación 24/7** sin supervisión humana
- **Respuesta inmediata** a contenido inapropiado
- **Educación de usuarios** mediante advertencias

### Servidor Discord + CBox
- **Moderación automática en CBox** mientras moderadores humanos gestionan Discord
- **Política consistente** de moderación entre plataformas

### Chat Corporativo
- **Cumplimiento automático** de políticas de comunicación
- **Documentación completa** de incidentes
- **Escalación automática** para casos severos

## 🔒 Seguridad

### Protecciones Implementadas
- **No procesa sus propios mensajes** (evita bucles)
- **Validación de sesión** antes de cada acción
- **Manejo de errores** sin exposición de información sensible
- **Rate limiting implícito** mediante la propia lógica de moderación

### Privacidad
- **Solo logs locales**: No se almacenan mensajes externamente
- **Análisis temporal**: Solo el mensaje actual se envía a OpenAI
- **Sin persistencia de usuario**: No se almacenan perfiles o historiales