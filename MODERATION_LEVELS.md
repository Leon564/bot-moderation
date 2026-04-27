# ⚙️ Sistema de Niveles de Moderación Configurables

## ✅ **Problema Resuelto**
Ahora puedes controlar qué tan estricto o permisivo es el bot desde el archivo `.env`, manteniendo siempre estricta la protección de información personal.

## 🎯 **Configuración en .env**

```env
# Niveles de moderación configurables
MODERATION_LEVEL = STRICT              # STRICT/MODERATE/LENIENT - Nivel de severidad
TOXICITY_THRESHOLD = 0.7               # 0.0-1.0 - Umbral de toxicidad (menor = más estricto)
CONTEXT_AWARENESS = true               # true/false - Considerar contexto y sarcasmo en análisis
```

## 🔥 **Niveles Disponibles**

### **1. STRICT (Estricto) - Por Defecto**
```env
MODERATION_LEVEL = STRICT
TOXICITY_THRESHOLD = 0.7
```

**❌ ELIMINA:**
- Cualquier insulto directo
- Groserías hacia usuarios
- Contenido sexual explícito
- Amenazas y discriminación
- Spam evidente

**✅ PERMITE:**
- Conversaciones normales
- Expresiones emocionales
- Opiniones fuertes respetuosas

### **2. MODERATE (Moderado)**
```env
MODERATION_LEVEL = MODERATE
TOXICITY_THRESHOLD = 0.5
```

**❌ ELIMINA:**
- Insultos maliciosos repetidos
- Amenazas directas
- Discriminación seria
- Spam masivo

**✅ PERMITE:**
- Lenguaje fuerte ocasional
- Bromas pesadas entre amigos
- Discusiones acaloradas
- Sarcasmo e ironía

### **3. LENIENT (Permisivo)**
```env
MODERATION_LEVEL = LENIENT
TOXICITY_THRESHOLD = 0.3
```

**❌ ELIMINA SOLO:**
- Insultos extremadamente ofensivos
- Amenazas directas creíbles
- Discriminación grave
- Contenido ilegal

**✅ PERMITE:**
- Lenguaje fuerte general
- Groserías no dirigidas
- Bromas pesadas
- Referencias sexuales no explícitas
- Debates intensos

### **4. PRIVACY_ONLY (Solo Privacidad)** ⭐ **NUEVO**
```env
MODERATION_LEVEL = PRIVACY_ONLY
TOXICITY_THRESHOLD = 0.0  # No importa, no se usa
```

**❌ ELIMINA SOLO:**
- Números de teléfono
- Emails
- Usuarios de redes sociales 
- Información personal sensible
- Spam fragmentado

**✅ PERMITE TODO LO DEMÁS:**
- Insultos y groserías
- Contenido sexual
- Spam conversacional
- Debates acalorados
- Cualquier lenguaje fuerte

## 🛡️ **Información Personal: Siempre Estricto**

**INDEPENDIENTE DEL NIVEL:**
```
❌ SIEMPRE ELIMINA:
- Números de teléfono
- Emails  
- Usuarios de redes sociales
- Información personal sensible
- Spam fragmentado (múltiples mensajes)
```

## 🧠 **Análisis Contextual**

```env
CONTEXT_AWARENESS = true  # Recomendado
```

**CON CONTEXTO (true):**
- Considera relaciones entre usuarios
- Detecta bromas amigables
- Entiende sarcasmo e ironía
- Análisis más inteligente

**SIN CONTEXTO (false):**
- Análisis directo del mensaje
- No considera historial
- Más rápido pero menos preciso

## 📊 **Umbral de Toxicidad**

```env
TOXICITY_THRESHOLD = 0.7  # Valor por defecto
```

**Valores recomendados:**
- `0.8-1.0`: Muy estricto (solo lo más ofensivo)
- `0.6-0.7`: Estricto (recomendado)
- `0.4-0.5`: Moderado 
- `0.1-0.3`: Permisivo
- `0.0`: Solo información personal

## 🎮 **Ejemplos de Configuración**

### **Chat Familiar (Muy Estricto)**
```env
MODERATION_LEVEL = STRICT
TOXICITY_THRESHOLD = 0.8
CONTEXT_AWARENESS = true
```

### **Chat Gaming (Moderado)**
```env
MODERATION_LEVEL = MODERATE
TOXICITY_THRESHOLD = 0.5
CONTEXT_AWARENESS = true
```

### **Chat Adultos (Permisivo)**
```env
MODERATION_LEVEL = LENIENT
TOXICITY_THRESHOLD = 0.3
CONTEXT_AWARENESS = true
```

### **Solo Información Personal** ⭐ **NUEVO**
```env
MODERATION_LEVEL = PRIVACY_ONLY
TOXICITY_THRESHOLD = 0.0
CONTEXT_AWARENESS = true
```

## 📈 **Logs del Sistema**

Al iniciar, el bot mostrará:
```
🛡️ Nivel de moderación: STRICT
🎯 Umbral de toxicidad: 0.7  
🧠 Análisis contextual: ENABLED
🔒 Protección información personal: ENABLED
```

## 🔄 **Cambios en Tiempo Real**

Para cambiar la configuración:
1. **Edita** el archivo `.env`
2. **Reinicia** el bot (`npm run start:dev`)
3. **Verifica** los logs de configuración

## ⚡ **Casos de Uso**

### **Mensaje: "eres tonto"**

**STRICT**: ❌ Eliminado (insulto directo)
**MODERATE**: ❌ Eliminado (insulto directo)  
**LENIENT**: ⚠️ Advertencia o ✅ Permitido (según contexto)
**PRIVACY_ONLY**: ✅ Permitido (no modera contenido)

### **Mensaje: "jajaja que pendejada"**

**STRICT**: ❌ Eliminado (grosería)
**MODERATE**: ✅ Permitido (lenguaje fuerte ocasional)
**LENIENT**: ✅ Permitido (lenguaje general)
**PRIVACY_ONLY**: ✅ Permitido (no modera contenido)

### **Mensaje: "mi discord es @usuario"**

**TODOS LOS NIVELES**: ❌ SIEMPRE ELIMINADO (información personal)

## 🎯 **Resultado**

Sistema completamente **configurable** y **flexible** que se adapta a cualquier tipo de comunidad, desde chats familiares hasta comunidades gaming, manteniendo siempre la protección contra información personal.