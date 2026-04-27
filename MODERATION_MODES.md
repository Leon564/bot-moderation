# 🛡️ Modos de Moderación del Bot

Este bot incluye múltiples modos de operación para adaptarse a diferentes necesidades de moderación de chat.

## 📋 Configuraciones Disponibles

### Variables de Entorno

```env
MODERATION_ENABLED = true           # Activar/desactivar moderación
AUTO_MODERATE_ALL = true            # Moderar todos los mensajes
AUTO_DELETE_MESSAGES = true         # Eliminar mensajes automáticamente
MODERATION_ONLY_MODE = true         # Modo solo moderación (silencioso)
```

## 🎛️ Modos de Operación

### 1. **Bot Completo** (Modo por defecto)
```env
MODERATION_ENABLED = true
AUTO_MODERATE_ALL = true
AUTO_DELETE_MESSAGES = true
MODERATION_ONLY_MODE = false
```
- ✅ Modera contenido inapropiado
- ✅ Responde a comandos y menciones
- ✅ Reproduce música
- ✅ Muestra usuarios online
- ✅ Elimina mensajes automáticamente
- ✅ Envía advertencias públicas

### 2. **Moderador Silencioso** (Nuevo)
```env
MODERATION_ENABLED = true
AUTO_MODERATE_ALL = true
AUTO_DELETE_MESSAGES = true
MODERATION_ONLY_MODE = true
```
- ✅ Modera contenido inapropiado
- ✅ Elimina mensajes automáticamente
- ✅ Envía advertencias por insultos/irrespeto
- ❌ No responde a comandos de música
- ❌ No responde a comandos de usuarios online
- ❌ No chatea en conversaciones normales
- 🎯 **Solo interviene para moderar comportamiento inapropiado**

### 3. **Solo Chat** (Sin moderación)
```env
MODERATION_ENABLED = false
AUTO_MODERATE_ALL = false
AUTO_DELETE_MESSAGES = false
MODERATION_ONLY_MODE = false
```
- ❌ No modera contenido
- ✅ Responde a comandos y menciones
- ✅ Reproduce música
- ✅ Muestra usuarios online

## 🎯 ¿Cuándo usar cada modo?

### Moderador Silencioso
- **Ideal para:** Chats donde ya hay moderadores humanos para funcionalidades
- **Ventaja:** Solo se enfoca en mantener el respeto, no distrae con comandos
- **Función:** Elimina insultos y envía advertencias educativas
- **Comportamiento:** No responde a música/comandos, solo modera comportamiento

### Bot Completo
- **Ideal para:** Chats sin moderadores humanos activos
- **Ventaja:** Educativo, advierte a usuarios sobre comportamiento
- **Función:** Moderación visible y educativa

## 📊 Monitoreo

### Comandos de Debug (Solo en modo completo)
- `moderation` - Ver estado actual
- `moderation toggle` - Cambiar estado

### Logs en Consola
```
🛡️ [AUTO-MOD] Moderando mensaje de Usuario...
🚫 [MOD] Mensaje bloqueado de Usuario: Insulto directo
🤐 [SILENT-MOD] Modo solo moderación activo
```

## ⚙️ Configuración Detallada

### Criterios de Moderación
- ❌ **Insultos directos** y groserías
- ❌ **Spam evidente** (mensajes repetitivos)
- ❌ **Amenazas** directas
- ❌ **Discriminación** grave
- ✅ **Permitido:** Mensajes cortos, off-topic, conversación normal

### Acciones Automáticas
- **warn**: Solo advertencia (modo completo)
- **timeout**: Elimina mensaje + advertencia (modo completo) / solo elimina (modo silencioso)
- **ban**: Elimina mensaje + advertencia (modo completo) / solo elimina (modo silencioso)

## 🔄 Cambio de Modos

Para cambiar entre modos, modifica el archivo `.env` y reinicia el bot:

```bash
# Para activar modo silencioso
MODERATION_ONLY_MODE=true

# Para volver a modo completo  
MODERATION_ONLY_MODE=false
```

## 🛠️ Casos de Uso

### Servidor Discord + CBox
```env
MODERATION_ONLY_MODE=true  # Bot silencioso en CBox
```
El bot modera silenciosamente en CBox mientras los moderadores humanos manejan Discord.

### CBox Primario
```env
MODERATION_ONLY_MODE=false  # Bot completo
```
El bot es el moderador principal y educa a los usuarios.

### Testing/Desarrollo
```env
MODERATION_ENABLED=false  # Sin moderación
```
Para probar funcionalidades sin interferencia de moderación.