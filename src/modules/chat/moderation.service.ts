import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

interface ModerationResult {
  isAllowed: boolean;
  reason?: string;
  severity: 'low' | 'medium' | 'high';
  category?: string;
  action: 'allow' | 'warn' | 'timeout' | 'ban';
  isPersonalInfo?: boolean; // Nueva propiedad para identificar información personal
}

@Injectable()
export class ModerationService {
  private openai: OpenAI;
  private model: string;
  private moderationEnabled: boolean;
  private personalInfoProtectionEnabled: boolean;
  private moderationLevel: string;
  private toxicityThreshold: number;
  private contextAwareness: boolean;
  private userMessageHistory: Map<string, Array<{message: string, timestamp: number}>> = new Map();
  private readonly CONTEXT_WINDOW_MS = 60000; // 1 minuto para analizar contexto
  private readonly MAX_MESSAGES_TO_ANALYZE = 3; // Analizar últimos 3 mensajes del usuario

  constructor(private readonly configService: ConfigService) {
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('openai.apiKey'),
      baseURL: this.configService.get<string>('openai.baseURL') || 'https://api.openai.com/v1',
    });

    // The moderation prompts were originally tuned for gpt-4o-mini, but the
    // deployment may be a deepseek/etc-compatible endpoint. Honor OPENAI_MODEL.
    this.model = this.configService.get<string>('openai.model') || 'gpt-4o-mini';

    this.moderationEnabled = this.configService.get<boolean>('bot.moderationEnabled') ?? true;
    this.personalInfoProtectionEnabled = this.configService.get<boolean>('bot.personalInfoProtection') ?? true;
    
    // Nuevas configuraciones de niveles
    this.moderationLevel = this.configService.get<string>('bot.moderationLevel') ?? 'STRICT';
    this.toxicityThreshold = this.configService.get<number>('bot.toxicityThreshold') ?? 0.7;
    this.contextAwareness = this.configService.get<boolean>('bot.contextAwareness') ?? true;
    
    console.log(`🛡️ Nivel de moderación: ${this.moderationLevel}`);
    console.log(`🎯 Umbral de toxicidad: ${this.toxicityThreshold}`);
    console.log(`🧠 Análisis contextual: ${this.contextAwareness ? 'ENABLED' : 'DISABLED'}`);
  }

  /**
   * Modera un mensaje usando GPT-4
   */
  async moderateMessage(
    message: string, 
    username: string, 
    userLevel: number = 1
  ): Promise<ModerationResult> {
    
    // Si la moderación está deshabilitada, permitir todo
    if (!this.moderationEnabled) {
      return {
        isAllowed: true,
        severity: 'low',
        action: 'allow'
      };
    }

    // Si está en modo PRIVACY_ONLY, agregar al historial pero solo moderar información personal
    if (this.moderationLevel === 'PRIVACY_ONLY') {
      console.log(`🔒 [PRIVACY-ONLY] Modo solo privacidad activo - verificando información personal de ${username}: "${message}"`);
      
      if (this.personalInfoProtectionEnabled) {
        // Agregar mensaje actual al historial del usuario
        this.addToUserHistory(username, message);
        
        // Analizar mensaje actual y contexto reciente SOLO para información personal
        const personalInfoCheck = await this.detectPersonalInformationWithContext(username, message);
        if (personalInfoCheck) {
          console.log(`🚨 [PRIVACY-ONLY] Información personal detectada de ${username}: ${personalInfoCheck.type} - ${personalInfoCheck.context || 'mensaje único'}`);
          return {
            isAllowed: false,
            severity: 'high',
            reason: personalInfoCheck.reason,
            category: 'personal_information',
            action: 'timeout',
            isPersonalInfo: true
          };
        }
      }
      
      // En modo PRIVACY_ONLY: Si no hay información personal, SIEMPRE permitir (sin moderar contenido)
      console.log(`✅ [PRIVACY-ONLY] Mensaje permitido de ${username}: "${message}" (sin información personal detectada)`);
      return {
        isAllowed: true,
        severity: 'low',
        action: 'allow'
      };
    }

    // PARA OTROS MODOS (STRICT/MODERATE/LENIENT): Verificar información personal primero
    if (this.personalInfoProtectionEnabled) {
      // Agregar mensaje actual al historial del usuario
      this.addToUserHistory(username, message);
      
      // Analizar mensaje actual y contexto reciente
      const personalInfoCheck = await this.detectPersonalInformationWithContext(username, message);
      if (personalInfoCheck) {
        console.log(`🚨 [PERSONAL-INFO] Información personal detectada de ${username}: ${personalInfoCheck.type} - ${personalInfoCheck.context || 'mensaje único'}`);
        return {
          isAllowed: false,
          severity: 'high',
          reason: personalInfoCheck.reason,
          category: 'personal_information',
          action: 'timeout',
          isPersonalInfo: true
        };
      }
    }

    try {
      console.log(`🛡️ [MOD] Moderando mensaje de ${username} (nivel ${userLevel}): "${message}"`);

      const systemPrompt = this.buildModerationPrompt(userLevel);
      
      const response = await this.openai.chat.completions.create({
        model: this.model, // Modelo más económico pero efectivo para moderación
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Usuario: ${username} (Nivel: ${userLevel})\nMensaje: "${message}"` }
        ],
        max_tokens: 200,
        temperature: 0.1, // Baja temperatura para respuestas consistentes
      });

      const result = response.choices[0]?.message?.content?.trim();
      
      if (!result) {
        console.warn('⚠️ [MOD] Respuesta vacía del moderador, permitiendo mensaje');
        return {
          isAllowed: true,
          severity: 'low',
          action: 'allow'
        };
      }

      return this.parseModerationResult(result, message, username);
      
    } catch (error) {
      console.error('❌ [MOD] Error en moderación automática:', error);
      
      // En caso de error, usar moderación básica local
      return this.fallbackModeration(message, username, userLevel);
    }
  }

  /**
   * Construye el prompt de moderación según el nivel del usuario y configuración
   */
  private buildModerationPrompt(userLevel: number): string {
    const levelConfig = this.getModerationConfig();
    
    const baseRules = `
Eres un moderador automático de un chat de anime/manga con nivel de severidad: ${this.moderationLevel}.

INFORMACIÓN PERSONAL (SIEMPRE ESTRICTO):
❌ SIEMPRE ELIMINAR: Números de teléfono, emails, usuarios de redes sociales compartidos
❌ NUNCA PERMITIR: Información personal sin importar el nivel de moderación

TOXICIDAD Y CONTENIDO (VARIABLE POR NIVEL):
${levelConfig.rules}

CONTEXTO Y ANÁLISIS:
${this.contextAwareness ? 
  '✅ Considera el contexto, sarcasmo, bromas amigables y relaciones entre usuarios' : 
  '❌ Análisis directo sin considerar contexto adicional'
}

UMBRAL DE TOXICIDAD: ${this.toxicityThreshold} (0.0 = muy permisivo, 1.0 = muy estricto)

NO MODERES POR:
1. ✅ Mensajes cortos o de pocas palabras
2. ✅ Conversaciones normales fuera del tema (anime/manga)
3. ✅ Bromas ligeras entre amigos conocidos
4. ✅ Expresiones emocionales normales
5. ✅ Opiniones fuertes pero respetuosas
6. ✅ Enlaces normales o recomendaciones
7. ✅ Apodos cariñosos entre usuarios frecuentes

NIVELES DE USUARIO:
- Nivel 1: No registrado (moderación ${levelConfig.userLevelModeration.level1})
- Nivel 2: Registrado (moderación ${levelConfig.userLevelModeration.level2})
- Nivel 3: Moderador (moderación ${levelConfig.userLevelModeration.level3})
- Nivel 4: Admin (moderación ${levelConfig.userLevelModeration.level4})`;

    const levelSpecificRules = this.getLevelSpecificRules(userLevel);

    return `${baseRules}

${levelSpecificRules}

RESPONDE EN FORMATO JSON:
{
  "allowed": true/false,
  "severity": "low"/"medium"/"high", 
  "reason": "explicación breve",
  "category": "spam"/"nsfw"/"toxicity"/"offtopic"/"promotion"/"illegal"/"personal_info",
  "action": "allow"/"warn"/"timeout"/"ban",
  "confidence": 0.0-1.0,
  "context_considered": true/false
}

ACCIONES SEGÚN NIVEL:
${levelConfig.actions}`;
  }

  /**
   * Obtiene la configuración según el nivel de moderación
   */
  private getModerationConfig() {
    switch (this.moderationLevel) {
      case 'STRICT':
        return {
          rules: `
❌ ELIMINAR: Cualquier insulto directo, groserías hacia usuarios, spam evidente
❌ ELIMINAR: Contenido sexual explícito o referencias sexuales fuertes
❌ ELIMINAR: Amenazas, discriminación, hate speech
❌ ELIMINAR: Contenido claramente ilegal
⚠️ ADVERTIR: Lenguaje fuerte ocasional, discusiones acaloradas`,
          userLevelModeration: {
            level1: 'muy estricta',
            level2: 'estricta', 
            level3: 'moderada',
            level4: 'relajada'
          },
          actions: `
- allow: Solo contenido completamente apropiado
- warn: Lenguaje fuerte ocasional, discusiones menores
- timeout: Insultos directos, spam, contenido sexual
- ban: Amenazas, discriminación grave, contenido ilegal`
        };
        
      case 'MODERATE':
        return {
          rules: `
❌ ELIMINAR: Insultos directos maliciosos, groserías ofensivas repetidas
❌ ELIMINAR: Contenido sexual explícito
❌ ELIMINAR: Amenazas directas, discriminación seria
❌ ELIMINAR: Spam masivo evidente
✅ PERMITIR: Lenguaje fuerte ocasional, bromas pesadas entre amigos
✅ PERMITIR: Discusiones acaloradas pero no ofensivas`,
          userLevelModeration: {
            level1: 'estricta',
            level2: 'moderada',
            level3: 'relajada', 
            level4: 'mínima'
          },
          actions: `
- allow: Contenido apropiado, lenguaje fuerte ocasional
- warn: Discusiones acaloradas, lenguaje borderline
- timeout: Insultos maliciosos, spam evidente
- ban: Amenazas directas, discriminación seria`
        };
        
      case 'LENIENT':
        return {
          rules: `
❌ ELIMINAR SOLO: Insultos extremadamente ofensivos y maliciosos
❌ ELIMINAR SOLO: Amenazas directas creíbles
❌ ELIMINAR SOLO: Discriminación grave y hate speech
❌ ELIMINAR SOLO: Contenido claramente ilegal
✅ PERMITIR: Lenguaje fuerte, groserías generales
✅ PERMITIR: Bromas pesadas, sarcasmo, ironía
✅ PERMITIR: Discusiones acaloradas y debates intensos
✅ PERMITIR: Contenido sexual no explícito (referencias, insinuaciones)`,
          userLevelModeration: {
            level1: 'moderada',
            level2: 'relajada',
            level3: 'mínima',
            level4: 'casi nula'
          },
          actions: `
- allow: Amplio rango de contenido, incluyendo lenguaje fuerte
- warn: Solo contenido borderline muy serio
- timeout: Insultos extremos, amenazas indirectas
- ban: Solo amenazas directas, discriminación extrema`
        };

      case 'PRIVACY_ONLY':
        return {
          rules: `
✅ PERMITIR TODO: Insultos, groserías, lenguaje fuerte, contenido sexual, debates
✅ PERMITIR TODO: Spam, conversaciones off-topic, bromas pesadas
✅ PERMITIR TODO: Cualquier tipo de contenido conversacional
❌ ELIMINAR SOLO: Información personal (teléfonos, emails, redes sociales)
🎯 MODO PRIVACIDAD: Solo protección de datos personales, sin moderación de contenido`,
          userLevelModeration: {
            level1: 'solo privacidad',
            level2: 'solo privacidad',
            level3: 'solo privacidad',
            level4: 'solo privacidad'
          },
          actions: `
- allow: TODO el contenido conversacional (insultos, groserías, etc.)
- warn: NUNCA por contenido, solo por información personal
- timeout: SOLO por compartir información personal
- ban: SOLO por spam masivo de información personal`
        };
        
      default:
        // Fallback a STRICT si hay un valor inválido
        this.moderationLevel = 'STRICT';
        return this.getModerationConfig();
    }
  }

  /**
   * Reglas específicas según el nivel del usuario
   */
  private getLevelSpecificRules(userLevel: number): string {
    switch (userLevel) {
      case 1: // No registrado
        return `USUARIO NO REGISTRADO - MODERACIÓN ENFOCADA:
- Vigilar spam más estrictamente
- Cuidado con insultos o groserías
- Permitir conversaciones normales aunque sean off-topic`;
        
      case 2: // Registrado
        return `USUARIO REGISTRADO - MODERACIÓN BÁSICA:
- Solo moderar insultos claros y spam
- Permitir todo tipo de conversaciones casuales
- Libertad para expresarse normalmente`;
        
      case 3: // Moderador
        return `MODERADOR - MODERACIÓN MÍNIMA:
- Solo intervenir en casos graves de insultos o amenazas
- Permitir lenguaje directo y expresiones fuertes
- Libertad casi total de expresión`;
        
      case 4: // Admin
        return `ADMINISTRADOR - SIN MODERACIÓN:
- Solo bloquear contenido claramente ilegal
- Libertad completa de expresión
- Confiar en su criterio como admin`;
        
      default:
        return `USUARIO DESCONOCIDO - MODERACIÓN ESTRICTA`;
    }
  }

  /**
   * Parsea la respuesta del modelo de moderación
   */
  private parseModerationResult(
    result: string, 
    message: string, 
    username: string
  ): ModerationResult {
    try {
      // Intentar parsear JSON
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No se encontró JSON en la respuesta');
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      
      const moderationResult: ModerationResult = {
        isAllowed: parsed.allowed === true,
        severity: parsed.severity || 'medium',
        reason: parsed.reason,
        category: parsed.category,
        action: parsed.action || (parsed.allowed ? 'allow' : 'warn')
      };

      console.log(`🛡️ [MOD] Resultado para ${username}:`, moderationResult);
      
      return moderationResult;
      
    } catch (error) {
      console.error('❌ [MOD] Error parseando respuesta de moderación:', error);
      console.error('❌ [MOD] Respuesta recibida:', result);
      
      // Fallback en caso de error de parsing
      return this.fallbackModeration(message, username, 1);
    }
  }

  /**
   * Moderación básica local como fallback
   */
  private fallbackModeration(
    message: string, 
    username: string, 
    userLevel: number
  ): ModerationResult {
    const lowerMessage = message.toLowerCase();
    
    // Palabras prohibidas básicas
    const bannedWords = ['puto', 'puta', 'idiota', 'estúpido', 'maricón', 'gay', 'negro'];
    const spamIndicators = ['compra', 'vende', 'gratis', '!!!', 'www.', 'http'];
    
    // Verificar palabras prohibidas
    const hasBannedWord = bannedWords.some(word => lowerMessage.includes(word));
    if (hasBannedWord) {
      return {
        isAllowed: false,
        severity: 'medium',
        reason: 'Lenguaje inapropiado detectado',
        category: 'toxicity',
        action: userLevel >= 3 ? 'warn' : 'timeout'
      };
    }
    
    // Verificar spam
    const spamScore = spamIndicators.filter(indicator => lowerMessage.includes(indicator)).length;
    if (spamScore >= 2) {
      return {
        isAllowed: false,
        severity: 'medium',
        reason: 'Posible spam detectado',
        category: 'spam',
        action: 'warn'
      };
    }
    
    // Si no hay problemas detectados
    return {
      isAllowed: true,
      severity: 'low',
      action: 'allow'
    };
  }

  /**
   * Ejecuta la acción de moderación recomendada
   */
  async executeModeration(
    result: ModerationResult,
    username: string,
    messageId?: string,
    deleteMessage?: (messageId: string) => Promise<boolean>
  ): Promise<string | null> {
    
    if (result.isAllowed) {
      return null; // No hay acción necesaria
    }

    console.log(`⚖️ [MOD] Ejecutando acción ${result.action} para ${username}: ${result.reason}`);

    // Verificar si la eliminación automática está habilitada
    const autoDeleteEnabled = this.configService.get<boolean>('bot.autoDeleteMessages') ?? false;

    switch (result.action) {
      case 'warn':
        // Si es un warning por toxicidad (insultos), eliminar el mensaje también
        if (result.category === 'toxicity' && autoDeleteEnabled && messageId && deleteMessage) {
          console.log(`🗑️ [MOD] Intentando eliminar mensaje ${messageId} (warn toxicity) - Auto-delete: ENABLED`);
          try {
            const deleted = await deleteMessage(messageId);
            if (deleted) {
              return `⚠️ ${username}: Mensaje eliminado - ${result.reason}. Por favor, mantén el respeto en el chat.`;
            } else {
              return `⚠️ ${username}: ${result.reason}. Por favor, mantén el respeto en el chat. (eliminación falló)`;
            }
          } catch (error) {
            console.error(`❌ [MOD] Error eliminando mensaje ${messageId}:`, error);
            return `⚠️ ${username}: ${result.reason}. Por favor, mantén el respeto en el chat. (error en eliminación)`;
          }
        } else {
          return `⚠️ ${username}: ${result.reason}. Por favor, mantén el respeto en el chat.`;
        }
        
      case 'timeout':
        // Intentar eliminar el mensaje solo si está habilitado y se proporcionó el ID y la función
        if (autoDeleteEnabled && messageId && deleteMessage) {
          console.log(`🗑️ [MOD] Intentando eliminar mensaje ${messageId} (timeout) - Auto-delete: ENABLED`);
          try {
            const deleted = await deleteMessage(messageId);
            if (deleted) {
              return `🔇 ${username}: Mensaje eliminado por ${result.reason}`;
            } else {
              return `🔇 ${username}: Mensaje bloqueado - ${result.reason} (eliminación falló)`;
            }
          } catch (error) {
            console.error(`❌ [MOD] Error eliminando mensaje ${messageId}:`, error);
            return `🔇 ${username}: Mensaje bloqueado - ${result.reason} (error en eliminación)`;
          }
        } else {
          console.log(`⚠️ [MOD] Eliminación automática: ${autoDeleteEnabled ? 'ENABLED' : 'DISABLED'}`);
          return `🔇 ${username}: Mensaje bloqueado - ${result.reason}`;
        }
        
      case 'ban':
        // Intentar eliminar el mensaje solo si está habilitado y se proporcionó el ID y la función
        if (autoDeleteEnabled && messageId && deleteMessage) {
          console.log(`🗑️ [MOD] Intentando eliminar mensaje ${messageId} (ban) - Auto-delete: ENABLED`);
          try {
            const deleted = await deleteMessage(messageId);
            if (deleted) {
              return `🔨 ${username}: Mensaje eliminado por comportamiento inaceptable - ${result.reason}`;
            } else {
              return `🔨 ${username}: Comportamiento inaceptable - ${result.reason} (eliminación falló)`;
            }
          } catch (error) {
            console.error(`❌ [MOD] Error eliminando mensaje ${messageId}:`, error);
            return `🔨 ${username}: Comportamiento inaceptable - ${result.reason} (error en eliminación)`;
          }
        } else {
          console.log(`⚠️ [MOD] Eliminación automática: ${autoDeleteEnabled ? 'ENABLED' : 'DISABLED'}`);
          return `🔨 ${username}: Comportamiento inaceptable - ${result.reason}`;
        }
        
      default:
        return null;
    }
  }

  /**
   * Agrega un mensaje al historial del usuario para análisis contextual
   */
  private addToUserHistory(username: string, message: string): void {
    const now = Date.now();
    
    if (!this.userMessageHistory.has(username)) {
      this.userMessageHistory.set(username, []);
    }
    
    const userHistory = this.userMessageHistory.get(username)!;
    
    // Agregar mensaje actual
    userHistory.push({ message, timestamp: now });
    
    // Limpiar mensajes antiguos (fuera del contexto temporal)
    const filteredHistory = userHistory.filter(
      entry => (now - entry.timestamp) <= this.CONTEXT_WINDOW_MS
    );
    
    // Mantener solo los últimos N mensajes
    const recentHistory = filteredHistory.slice(-this.MAX_MESSAGES_TO_ANALYZE);
    
    this.userMessageHistory.set(username, recentHistory);
  }

  /**
   * Detecta información personal usando contexto de mensajes recientes
   */
  private async detectPersonalInformationWithContext(username: string, currentMessage: string): Promise<{ type: string; reason: string; context?: string } | null> {
    try {
      const userHistory = this.userMessageHistory.get(username) || [];
      
      // Si solo hay un mensaje, usar análisis simple
      if (userHistory.length <= 1) {
        const simpleCheck = await this.detectPersonalInformationWithGPT(currentMessage);
        return simpleCheck;
      }
      
      // Construir contexto de mensajes recientes
      const recentMessages = userHistory
        .map((entry, index) => `${index + 1}. "${entry.message}" (${Math.floor((Date.now() - entry.timestamp) / 1000)}s atrás)`)
        .join('\n');

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `Eres un detector avanzado de información personal que analiza SECUENCIAS DE MENSAJES para detectar spam fragmentado.

Los usuarios pueden dividir información personal en múltiples mensajes para evitar detección:

EJEMPLOS DE SPAM FRAGMENTADO:
- Mensaje 1: "sígueme en facebook"
- Mensaje 2: "@miusuario"
= SPAM DETECTADO (compartir red social fragmentado)

- Mensaje 1: "mi numero es"  
- Mensaje 2: "123-456-7890"
= SPAM DETECTADO (teléfono fragmentado)

- Mensaje 1: "búscame en instagram"
- Mensaje 2: "como @usuario123"  
= SPAM DETECTADO (red social fragmentado)

NO ES SPAM:
- Mensaje 1: "hola @usuario"
- Mensaje 2: "como estas"
= Conversación normal

- Mensaje 1: "@usuario tienes discord?"
- Mensaje 2: "quiero preguntarte algo"
= Pregunta legítima

ANALIZA LA SECUENCIA COMPLETA y detecta si hay intención de compartir información personal (números, emails, usuarios de redes sociales) aunque esté dividida en múltiples mensajes.

Responde SOLO en formato JSON:
{
  "isPersonalInfo": true/false,
  "type": "phone"/"email"/"social_media"/"none",
  "reason": "explicación del patrón detectado",
  "context": "fragmentado"/"mensaje_unico"
}`
          },
          {
            role: 'user',
            content: `Usuario: ${username}
Secuencia de mensajes recientes:
${recentMessages}

¿Hay spam de información personal en esta secuencia?`
          }
        ],
        max_tokens: 200,
        temperature: 0.1
      });

      const result = response.choices[0]?.message?.content?.trim();
      if (!result) return null;

      const parsed = JSON.parse(result);
      
      if (parsed.isPersonalInfo && parsed.type !== 'none') {
        console.log(`🤖 [GPT-CONTEXT] Spam fragmentado detectado: ${parsed.type} - ${parsed.reason}`);
        return {
          type: parsed.type,
          reason: parsed.reason || 'Información personal fragmentada detectada',
          context: parsed.context || 'fragmentado'
        };
      }

      return null;
      
    } catch (error) {
      console.error('❌ [GPT-CONTEXT] Error:', error);
      // Fallback al análisis simple si el contextual falla
      return await this.detectPersonalInformationWithGPT(currentMessage);
    }
  }

  /**
   * Detecta información personal usando GPT para análisis más inteligente
   */
  private async detectPersonalInformationWithGPT(message: string): Promise<{ type: string; reason: string; context?: string } | null> {
    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `Eres un detector de información personal sensible en mensajes de chat. Analiza si el mensaje contiene:

1. NÚMEROS DE TELÉFONO (cualquier formato)
2. CORREOS ELECTRÓNICOS 
3. USUARIOS DE REDES SOCIALES compartidos con intención de contacto externo

IMPORTANTE: 
- @usuario en contexto de mención normal del chat = NO ES SPAM
- "mi discord es @usuario" o "sígueme en @usuario" = SÍ ES SPAM
- "búscame en instagram como @usuario" = SÍ ES SPAM
- "hola @usuario" o "@usuario que tal" = NO ES SPAM (mención normal)

Responde SOLO en formato JSON:
{
  "isPersonalInfo": true/false,
  "type": "phone"/"email"/"social_media"/"none",
  "reason": "explicación breve si es información personal"
}

Si no hay información personal sensible, responde: {"isPersonalInfo": false, "type": "none"}`
          },
          {
            role: 'user',
            content: `Analiza este mensaje: "${message}"`
          }
        ],
        max_tokens: 150,
        temperature: 0.1
      });

      const result = response.choices[0]?.message?.content?.trim();
      if (!result) return null;

      const parsed = JSON.parse(result);
      
      if (parsed.isPersonalInfo && parsed.type !== 'none') {
        console.log(`🤖 [GPT-PERSONAL-INFO] Detectado: ${parsed.type} - ${parsed.reason}`);
        return {
          type: parsed.type,
          reason: parsed.reason || 'Información personal detectada',
          context: 'mensaje_unico'
        };
      }

      return null;
      
    } catch (error) {
      console.error('❌ [GPT-PERSONAL-INFO] Error:', error);
      // Fallback al método regex si GPT falla
      return this.detectPersonalInformation(message);
    }
  }

  /**
   * Detecta información personal sensible en el mensaje (método de respaldo)
   */
  private detectPersonalInformation(message: string): { type: string; reason: string; context?: string } | null {
    const lowerMessage = message.toLowerCase().replace(/\s+/g, ' ').trim();
    
    // Filtrar menciones legítimas del chat antes de verificar redes sociales
    if (this.isJustChatMention(message)) {
      return null; // No es información personal, es una mención normal del chat
    }
    
    // Patrones para números de teléfono
    const phonePatterns = [
      /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/, // Formato XXX-XXX-XXXX
      /\b\d{10,}\b/, // 10 o más dígitos seguidos
      /\+\d{1,3}[-.\s]?\d{3,14}\b/, // Formato internacional
      /\b\d{3}[-.\s]?\d{7,}\b/, // Formato general
      /whatsapp|wsp|wa\.me/i, // Referencias a WhatsApp
    ];

    // Patrones para redes sociales (solo cuando hay contexto específico)
    const socialMediaPatterns = [
      // Solo detectar @usuario cuando hay contexto explícito de red social
      /\b(instagram|insta|ig)[\s:]*[@]?([a-zA-Z0-9._]{3,30})\b/i,
      /\b(twitter|x\.com)[\s:]*[@]?([a-zA-Z0-9._]{3,30})\b/i,
      /\b(facebook|fb)[\s:]*[@/]?([a-zA-Z0-9._]{3,50})\b/i,
      /\b(telegram|tg)[\s:]*[@]?([a-zA-Z0-9._]{3,30})\b/i,
      /\b(discord)[\s:]*[@]?([\w.#@]{3,50})\b/i, // Agregado @ en el grupo de captura
      /\b(tiktok|tt)[\s:]*[@]?([a-zA-Z0-9._]{3,30})\b/i,
      /\b(youtube|yt)[\s:]*[@/]?([a-zA-Z0-9._]{3,50})\b/i,
      /\b(snapchat|snap)[\s:]*[@]?([a-zA-Z0-9._]{3,30})\b/i,
      // Detectar patrones obvios de compartir usuarios de redes sociales
      /\b(sígueme|follow me|sigueme|add me|búscame|buscame)[\s\w]*[@]([a-zA-Z0-9._]{3,30})\b/i,
      /\b[@]([a-zA-Z0-9._]{3,30})[\s]*(en|on|de)[\s]*(insta|ig|tiktok|twitter|facebook|fb|snap)\b/i,
    ];

    // Patrones para correos electrónicos
    const emailPatterns = [
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    ];

    // Verificar números de teléfono
    for (const pattern of phonePatterns) {
      if (pattern.test(lowerMessage)) {
        return {
          type: 'phone',
          reason: 'Compartir números de teléfono',
          context: 'regex'
        };
      }
    }

    // Verificar redes sociales
    for (const pattern of socialMediaPatterns) {
      if (pattern.test(lowerMessage)) {
        return {
          type: 'social_media',
          reason: 'Compartir usuarios de redes sociales',
          context: 'regex'
        };
      }
    }

    // Verificar correos electrónicos
    for (const pattern of emailPatterns) {
      if (pattern.test(lowerMessage)) {
        return {
          type: 'email',
          reason: 'Compartir direcciones de correo electrónico',
          context: 'regex'
        };
      }
    }

    return null;
  }

  /**
   * Determina si un mensaje contiene solo menciones legítimas del chat
   * y no información de redes sociales
   */
  private isJustChatMention(message: string): boolean {
    const lowerMessage = message.toLowerCase().trim();
    
    // Patrones que indican que es solo una mención normal del chat
    const chatMentionPatterns = [
      /^@\w+\s*$/, // Solo "@usuario" 
      /^@\w+\s+\w{1,10}\s*$/, // "@usuario hola" (mensaje corto después de mención)
      /^@\w+\s+(hola|hi|hey|como\s+estas|que\s+tal|buenas)\b/i, // Saludos
      /^@\w+\s+(que|qué|como|cómo|donde|dónde|cuando|cuándo|por\s+qué)\b/i, // Preguntas
    ];
    
    // Si coincide con patrones de mención normal del chat, no es información personal
    for (const pattern of chatMentionPatterns) {
      if (pattern.test(lowerMessage)) {
        return true;
      }
    }
    
    // Si contiene palabras que indican compartir redes sociales, NO es solo mención del chat
    const socialSharingKeywords = [
      'sígueme', 'sigueme', 'follow', 'add me', 'búscame', 'buscame',
      'instagram', 'insta', 'ig', 'tiktok', 'twitter', 'facebook', 'fb',
      'telegram', 'discord', 'snapchat', 'snap', 'youtube', 'yt',
      'mi usuario', 'mi cuenta', 'mi perfil', 'estoy en', 'me encuentras en'
    ];
    
    const hasSocialKeywords = socialSharingKeywords.some(keyword => 
      lowerMessage.includes(keyword)
    );
    
    if (hasSocialKeywords) {
      return false; // Contiene palabras de redes sociales, procesar como información personal
    }
    
    // Si solo contiene una mención (@usuario) sin contexto de redes sociales, es mención del chat
    const onlyMentionPattern = /^[^@]*@\w+[^@]*$/;
    const hasMultipleMentions = (message.match(/@/g) || []).length > 1;
    
    return onlyMentionPattern.test(message) && !hasMultipleMentions;
  }

  /**
   * Obtiene estadísticas de moderación
   */
  getModerationStats(): any {
    // Aquí podrías implementar un sistema de estadísticas
    return {
      enabled: this.moderationEnabled,
      model: 'gpt-4o-mini',
      status: 'active'
    };
  }

  /**
   * Habilita/deshabilita la moderación
   */
  setModerationEnabled(enabled: boolean): void {
    this.moderationEnabled = enabled;
    console.log(`🛡️ [MOD] Moderación automática ${enabled ? 'habilitada' : 'deshabilitada'}`);
  }
}