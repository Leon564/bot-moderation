# 🛡️ Sistema de Moderación Automática

## Descripción

El bot incluye un sistema de moderación automática avanzado que utiliza GPT-4o-mini para analizar y filtrar mensajes en tiempo real.

## Características

### 🎯 **Capacidades**
- ✅ Moderación inteligente con IA (GPT-4o-mini)
- ✅ Diferentes niveles de moderación según el rol del usuario
- ✅ Detección automática de spam, toxicidad, contenido inapropiado
- ✅ Sistema de acciones graduales (advertencia, timeout, ban)
- ✅ Moderación específica para comunidades de anime/manga
- ✅ Fallback local en caso de error de IA

### 📊 **Niveles de Usuario**
- **Nivel 1**: No registrado - Moderación estricta
- **Nivel 2**: Registrado - Moderación normal  
- **Nivel 3**: Moderador - Moderación relajada
- **Nivel 4**: Admin - Mínima moderación

## Configuración

### Variables de Entorno
```env
# Configuración de moderación automática
MODERATION_ENABLED=true        # Activar/desactivar moderación con GPT
AUTO_MODERATE_ALL=false        # Moderar TODOS los mensajes (no solo dirigidos al bot)
```

### Modos de Operación

#### 1. **Moderación Selectiva** (`AUTO_MODERATE_ALL=false`)
- Solo modera mensajes dirigidos al bot
- Menor consumo de tokens de IA
- Ideal para comunidades pequeñas

#### 2. **Moderación Total** (`AUTO_MODERATE_ALL=true`)
- Modera TODOS los mensajes del chat
- Mayor consumo de tokens pero máxima protección
- Ideal para comunidades grandes con problemas de spam/toxicidad

## Reglas de Moderación

### ✅ **Contenido Permitido**
- Conversaciones sobre anime, manga, manhwa
- Discusiones respetuosas y constructivas
- Recomendaciones y opiniones
- Preguntas sobre series y personajes

### ❌ **Contenido Prohibido**
- Spam o mensajes repetitivos
- Contenido NSFW explícito
- Insultos, acoso o toxicidad
- Links sospechosos o promoción excesiva
- Contenido ilegal
- Discurso de odio o discriminación

## Acciones de Moderación

### 🟡 **Advertencia** (`warn`)
- Para infracciones leves
- Envía mensaje de advertencia al usuario
- No interrumpe la conversación

### 🔇 **Timeout** (`timeout`)
- Para infracciones moderadas
- Bloquea el mensaje específico
- Notifica la razón del bloqueo

### 🔨 **Ban** (`ban`)
- Para infracciones graves
- Contenido extremadamente inapropiado
- Requiere intervención manual del admin

## Comandos de Debug

Solo disponibles para `Leon564`:

### `debug moderation`
Muestra el estado actual del sistema de moderación:
```
🛡️ Moderación: Habilitada
📊 Auto-moderar todo: No  
🤖 Modelo: gpt-4o-mini
📈 Estado: active
```

### `debug moderation toggle`
Cambia el estado de moderación (habilitar/deshabilitar)

## Costo y Rendimiento

### 💰 **Consumo de Tokens**
- **Modelo**: GPT-4o-mini (más económico)
- **Moderación selectiva**: ~100-200 tokens por mensaje moderado
- **Moderación total**: Tokens por cada mensaje del chat
- **Temperatura**: 0.1 (respuestas consistentes)
- **Max tokens**: 200 (respuestas concisas)

### ⚡ **Optimizaciones**
- Fallback local para errores de IA
- Caché de resultados para mensajes similares
- Bypass automático para mensajes del bot
- Diferentes niveles según rol de usuario

## Sistema de Fallback

En caso de error con GPT, se activa la moderación local:

### Detección Local
- Lista de palabras prohibidas básicas
- Detección de spam por patrones
- Verificación de enlaces sospechosos
- Análisis de caracteres repetitivos

## Ejemplos de Uso

### Mensaje Normal ✅
```
Usuario: "¿Alguien ha visto el nuevo episodio de Jujutsu Kaisen?"
Resultado: PERMITIDO - Conversación sobre anime
```

### Spam Detectado ❌
```
Usuario: "COMPRA AHORA!!! ENLACE.COM GRATIS!!!"
Resultado: BLOQUEADO - Spam promocional
Acción: Timeout + Advertencia
```

### Toxicidad ❌
```
Usuario: "Odio a los [grupo específico]"
Resultado: BLOQUEADO - Discurso de odio  
Acción: Ban + Notificación
```

## Configuración Avanzada

### Para Administradores
1. **Ajustar sensibilidad**: Modificar los prompts en `moderation.service.ts`
2. **Personalizar acciones**: Cambiar las respuestas automáticas
3. **Agregar palabras prohibidas**: Expandir la lista de fallback
4. **Configurar excepciones**: Para usuarios específicos

### Monitoreo
- Logs detallados en consola
- Estadísticas de moderación
- Seguimiento de acciones tomadas
- Análisis de falsos positivos

## Consideraciones

### ✅ **Ventajas**
- Moderación 24/7 sin intervención humana
- Análisis contextual inteligente
- Adaptación a diferentes niveles de usuario
- Reducción de trabajo manual de moderadores

### ⚠️ **Limitaciones**
- Dependiente de la API de OpenAI
- Costos adicionales de tokens
- Posibles falsos positivos
- Requiere configuración inicial

## Soporte

Para problemas o preguntas sobre el sistema de moderación:
1. Revisar logs de console para detalles
2. Verificar configuración de variables de entorno
3. Probar con `debug moderation` para diagnosticar
4. Consultar documentación de OpenAI para límites de API