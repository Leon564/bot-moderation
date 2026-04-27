# 🤖 Comandos Inteligentes de Control de Moderación

Este documento describe el sistema de comandos inteligentes que usa **GPT para interpretar lenguaje natural** y controlar el bot de moderación.

## 🧠 Sistema Inteligente

El bot ahora usa **GPT-4o-mini** para interpretar comandos en **lenguaje natural**, lo que significa que no necesitas recordar sintaxis específica. ¡Habla naturalmente!

## 🔑 Permisos Requeridos

Solo usuarios con nivel **Moderador** (`Mod`) o **Administrador** (`Adm`) pueden usar estos comandos.

## � Comandos en Lenguaje Natural

### ⏸️ Pausar Moderación

**Ejemplos que funcionan:**
- `pausa el bot 30 minutos`
- `desactiva la moderación por 2 horas`
- `bot para de moderar por 1 día`
- `detén la moderación 3 días`
- `quita el bot por 1 semana`
- `suspende moderación 45 minutos`
- `pausa moderación por 12 horas`
- `desactiva bot 2 días`

### ▶️ Reanudar Moderación

**Ejemplos que funcionan:**
- `reactiva el bot`
- `reanuda moderación`
- `activa el bot de nuevo`
- `que vuelva la moderación`
- `bot vuelve a moderar`
- `continúa moderando`

### 📊 Consultar Estado

**Ejemplos que funcionan:**
- `como está el bot?`
- `estado de moderación`
- `está funcionando la moderación?`
- `que tal el bot?`
- `cómo va la moderación?`
- `bot está activo?`

## 🎯 Ventajas del Sistema Inteligente

### ✅ **Antes (rígido):**
```
❌ !pausar moderacion 30 min  (sintaxis exacta)
❌ !reanudar mod              (comando específico)
```

### 🚀 **Ahora (flexible):**
```
✅ "pausa el bot 30 minutos"     (lenguaje natural)
✅ "desactiva moderación 2h"     (abreviaciones)
✅ "bot para de moderar 15min"   (informal)
✅ "reactiva moderación"         (directo)
```

## � Interpretación Inteligente

### Patrones que reconoce GPT:

**⏸️ Para pausar:**
- Palabras clave: `pausa`, `desactiva`, `detén`, `suspende`, `para`
- Tiempo: `30 min`, `2 horas`, `1 día`, `3 días`, `1 semana`, `15 minutos`
- Objetivo: `bot`, `moderación`, `mod`

**▶️ Para reanudar:**
- Palabras clave: `reactiva`, `reanuda`, `activa`, `vuelve`, `continúa`
- Objetivo: `bot`, `moderación`, `mod`

**📊 Para estado:**
- Palabras clave: `estado`, `cómo está`, `funcionando`, `activo`
- Preguntas: `?` al final

## � Ejemplos de Conversación Real

### Escenario 1: Evento Especial
```
Moderador: "desactiva la moderación por 2 horas, vamos a hacer evento"
Bot: 🤖 [GPT-COMMAND] Interpretación: {"action": "pause", "duration": 2, "unit": "hours"}
Bot: 🔴 Moderación PAUSADA por Moderador durante 2 hora(s)

[... 2 horas después ...]
Bot: 🟢 Moderación REANUDADA automáticamente (tiempo expirado)
```

### Escenario 2: Día libre
```
Admin: "pausa la moderación 1 día"
Bot: 🤖 [GPT-COMMAND] Interpretación: {"action": "pause", "duration": 1, "unit": "days"}
Bot: 🔴 Moderación PAUSADA por Admin durante 1 día(s)

Admin: "estado del bot"
Bot: 🤖 [GPT-COMMAND] Interpretación: {"action": "status"}
Bot: � Estado de moderación: PAUSADA (18 hora(s) restantes)
```

### Escenario 3: Emergencia
```
Admin: "bot para de moderar ya"
Bot: 🤖 [GPT-COMMAND] Interpretación: {"action": "pause", "duration": 30, "unit": "minutes"}
Bot: � Moderación PAUSADA por Admin durante 30 minuto(s)

Admin: "reactiva moderación"
Bot: 🤖 [GPT-COMMAND] Interpretación: {"action": "resume"}
Bot: 🟢 Moderación REANUDADA por Admin
```

## 🛡️ Seguridad y Precisión

### 🚫 **Mensajes que NO son comandos:**
- `"hola como están todos"`
- `"que opinan del nuevo anime"`
- `"alguien vio el episodio"`
- `"pausa la música"` (no es moderación)

### ✅ **Mensajes que SÍ son comandos:**
- `"pausa el bot de moderación"`
- `"desactiva la moderación"`
- `"reactiva el bot"`

## 🔍 Logs Detallados

El sistema proporciona logs completos de interpretación:

```bash
🤖 [GPT-COMMAND] Interpretación para "pausa bot 15 min": {"action": "pause", "duration": 15, "unit": "minutes"}
🎛️ [MOD-CONTROL] Comando GPT de Usuario (Mod): {"action": "pause", "duration": 15, "unit": "minutes"}
⏸️ [MOD-CONTROL] Moderación PAUSADA por Usuario durante 15 minuto(s)
```

## ⚙️ Configuración

El sistema usa la misma API key de OpenAI configurada para moderación. No requiere configuración adicional.

## � Beneficios

1. **🗣️ Lenguaje Natural**: Habla como normalmente lo harías
2. **🧠 Inteligencia**: GPT entiende contexto e intención
3. **⚡ Flexible**: Múltiples formas de decir lo mismo
4. **🔒 Seguro**: Solo moderadores/admins pueden usarlo
5. **📝 Detallado**: Logs completos de interpretación
6. **🕐 Auto-expiración**: Se reanuda automáticamente

¡Ahora puedes controlar el bot de moderación hablando naturalmente! 🎉