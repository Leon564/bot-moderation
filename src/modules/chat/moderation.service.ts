import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export interface ModerationResult {
  isAllowed: boolean;
  reason?: string;
  severity: 'low' | 'medium' | 'high';
  category?: string;
  action: 'allow' | 'warn' | 'timeout' | 'ban';
  isPersonalInfo?: boolean; // Nueva propiedad para identificar información personal
  /** Where the decision came from. Useful for auditing and metrics. */
  source?: 'pre_filter' | 'llm' | 'llm_cached' | 'fallback' | 'personal_info';
  /** Raw text from the LLM (only set when source = 'llm'). */
  llmRaw?: string;
}

@Injectable()
export class ModerationService {
  private openai: OpenAI;
  private model: string;
  private moderationEnabled: boolean;
  private personalInfoProtectionEnabled: boolean;
  private moderationLevel: string;
  private userMessageHistory: Map<string, Array<{message: string, timestamp: number}>> = new Map();
  private readonly CONTEXT_WINDOW_MS = 60000; // 1 minuto para analizar contexto
  private readonly MAX_MESSAGES_TO_ANALYZE = 3; // Analizar últimos 3 mensajes del usuario

  // ── LLM circuit breaker ────────────────────────────────────────────────
  // After N consecutive LLM failures the breaker opens for COOLDOWN_MS, during
  // which the LLM call is skipped and we fall back to the regex-only path.
  // Auto-closes on the next success after the cool-down expires.
  private llmFailureStreak = 0;
  private llmCircuitOpenUntil = 0;
  private static readonly LLM_FAIL_THRESHOLD = 5;
  private static readonly LLM_COOLDOWN_MS = 2 * 60 * 1000;

  // ── LLM decision cache ────────────────────────────────────────────────
  // LRU + TTL cache keyed by normalized message content. A flood of identical
  // spam messages from different users only burns a single LLM call.
  private llmCache = new Map<string, { result: ModerationResult; expiresAt: number }>();
  private llmCacheMaxEntries = 1000;
  private llmCacheTtlMs = 5 * 60 * 1000;

  // Pre-LLM spam patterns. These hit before any model call so deterministic
  // junk like "AAAAA" or "------" stops in microseconds without burning tokens
  // on it.
  private readonly REPEATED_CHAR_RE = /(.)\1{5,}/;          // 6+ identical chars in a row
  private readonly NO_LETTERS_RE = /^[^A-Za-zÁ-ÿ]{5,}$/;     // 5+ chars and no letters at all
  private readonly DEDUP_WINDOW_MS = 60_000;                 // same message twice within 1m = spam

  // Slurs / hate speech that we always block regardless of MODERATION_LEVEL.
  // Intentionally short: only words that are unequivocally a slur in any
  // common context. Casual swears (mierda, joder, etc.) live in the LLM path
  // because they need context.
  // Patterns are matched against the *normalized* text (see `normalize()`),
  // so leetspeak / Cyrillic confusables / spaced-out evasion all hit too.
  private readonly HARD_BLOCKLIST: RegExp[] = [
    /\b(maric[oó]n(es|a|az[oa])?|mariposon)\b/i,
    /\bputo(s)?\s+(de\s+mierda|asqueroso)\b/i,
    /\bn[ei]g(ga|ger|grata)s?\b/i,
    /\bretra(sad[oa]|so)\b/i,
    /\bsubnormal(es)?\b/i,
    /\bimbecil(es)?\b/i,
    /\bautista\s+de\s+mierda\b/i,
  ];

  // Unicode confusables map (Cyrillic / Greek lookalikes → Latin). Covers the
  // common evasion vectors; not exhaustive on purpose.
  private static readonly CONFUSABLES: Record<string, string> = {
    а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', х: 'x', у: 'y', к: 'k', М: 'M',
    Α: 'A', Β: 'B', Ε: 'E', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O',
    Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X', Ζ: 'Z',
  };

  // Leet → letter substitutions only applied where it makes sense (mid-word).
  private static readonly LEET: Record<string, string> = {
    '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't',
    '@': 'a', $: 's',
  };

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
    this.moderationLevel = this.configService.get<string>('bot.moderationLevel') ?? 'STRICT';

    this.llmCacheTtlMs = this.configService.get<number>('bot.llmCache.ttlMs') ?? this.llmCacheTtlMs;
    this.llmCacheMaxEntries = this.configService.get<number>('bot.llmCache.maxEntries') ?? this.llmCacheMaxEntries;

    console.log(`🛡️ Nivel de moderación: ${this.moderationLevel}`);
  }

  /** LRU read with TTL expiry. Promotes the hit entry to most-recent. */
  private cacheGet(key: string): ModerationResult | null {
    const entry = this.llmCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.llmCache.delete(key);
      return null;
    }
    // Re-insert to bump LRU position.
    this.llmCache.delete(key);
    this.llmCache.set(key, entry);
    return entry.result;
  }

  private cacheSet(key: string, result: ModerationResult): void {
    if (this.llmCache.size >= this.llmCacheMaxEntries) {
      // Map preserves insertion order, so the first key is the oldest.
      const oldestKey = this.llmCache.keys().next().value;
      if (oldestKey) this.llmCache.delete(oldestKey);
    }
    this.llmCache.set(key, { result, expiresAt: Date.now() + this.llmCacheTtlMs });
  }

  /**
   * Modera un mensaje usando GPT-4
   */
  async moderateMessage(
    message: string,
    username: string,
    userLevel: number = 1,
    options: { reputationHint?: string } = {},
  ): Promise<ModerationResult> {
    
    // Si la moderación está deshabilitada, permitir todo
    if (!this.moderationEnabled) {
      return {
        isAllowed: true,
        severity: 'low',
        action: 'allow'
      };
    }

    // Cheap deterministic checks first — repeated chars, symbol-only blasts,
    // duplicated messages, and unequivocal slurs. These don't need an LLM and
    // don't change with MODERATION_LEVEL: hate speech is hate speech, spam is
    // spam.
    const preCheck = this.runPreLlmChecks(message, username);
    if (preCheck) {
      this.addToUserHistory(username, message);
      return preCheck;
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
          this.userMessageHistory.delete(username);
          return {
            isAllowed: false,
            severity: 'high',
            reason: personalInfoCheck.reason,
            category: 'personal_information',
            action: 'timeout',
            isPersonalInfo: true,
            source: 'personal_info',
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
        this.userMessageHistory.delete(username);
        return {
          isAllowed: false,
          severity: 'high',
          reason: personalInfoCheck.reason,
          category: 'personal_information',
          action: 'timeout',
          isPersonalInfo: true,
          source: 'personal_info',
        };
      }
    }

    // Cache lookup — skips both the LLM call and the circuit-breaker bypass.
    // We don't cache when a per-user reputation hint is in play; the result
    // would be biased and would poison subsequent calls from other users.
    const cacheKey = this.normalize(message);
    const useCache = !options.reputationHint;
    if (useCache) {
      const cached = this.cacheGet(cacheKey);
      if (cached) {
        console.log(`💾 [MOD] cache hit para ${username}: "${message}"`);
        return { ...cached, source: 'llm_cached' };
      }
    }

    // Circuit breaker: if too many recent LLM calls failed, skip the LLM
    // entirely until the cool-down expires.
    if (Date.now() < this.llmCircuitOpenUntil) {
      console.warn('⚠️ [MOD] Circuit breaker abierto — usando fallback regex');
      return this.fallbackModeration(message, username, userLevel);
    }

    try {
      console.log(`🛡️ [MOD] Moderando mensaje de ${username}: "${message}"`);

      const systemPrompt = options.reputationHint
        ? `${this.buildModerationPrompt()}\n\nNOTA SOBRE EL USUARIO: ${options.reputationHint}`
        : this.buildModerationPrompt();

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Mensaje a moderar:\n"${message}"` },
        ],
        max_tokens: 200,
        temperature: 0.1,
      });

      const result = response.choices[0]?.message?.content?.trim();

      if (!result) {
        console.warn('⚠️ [MOD] Respuesta vacía del moderador, permitiendo mensaje');
        // Empty response does NOT count as a failure — the API responded.
        this.llmFailureStreak = 0;
        return {
          isAllowed: true,
          severity: 'low',
          action: 'allow',
        };
      }

      // Successful LLM call — close the breaker and reset the failure streak.
      this.llmFailureStreak = 0;
      this.llmCircuitOpenUntil = 0;
      const parsed = this.parseModerationResult(result, message, username);
      if (useCache) this.cacheSet(cacheKey, parsed);
      return parsed;
    } catch (error) {
      this.llmFailureStreak += 1;
      console.error(`❌ [MOD] Error en LLM (${this.llmFailureStreak}/${ModerationService.LLM_FAIL_THRESHOLD}):`, error);

      if (this.llmFailureStreak >= ModerationService.LLM_FAIL_THRESHOLD) {
        this.llmCircuitOpenUntil = Date.now() + ModerationService.LLM_COOLDOWN_MS;
        console.warn(`🔌 [MOD] Circuit breaker ABIERTO por ${ModerationService.LLM_COOLDOWN_MS / 1000}s — fallback regex temporal`);
      }

      return this.fallbackModeration(message, username, userLevel);
    }
  }

  /**
   * Builds the moderation prompt. Designed to read like instructions to a
   * human moderator: short, concrete examples, no numeric thresholds, no
   * abstract level matrix. The LLM does best when told "block X, allow Y"
   * with examples of each.
   */
  private buildModerationPrompt(): string {
    const tone = this.getToneForLevel();

    return `Eres un moderador humano de un chat de anime/manga en español. Tu trabajo es eliminar lo que un mod razonable eliminaría y dejar pasar todo lo demás. Sé natural y consistente, no robótico.

POSTURA: ${tone}

ELIMINA SIEMPRE:
- Insultos directos a otros usuarios ("eres un X", "X de mierda").
- Discriminación, slurs racistas/homofóbicos/transfóbicos, hate speech.
- Acoso o ataques sostenidos a una persona.
- Spam: texto repetido, flood, símbolos sin sentido, mensajes idénticos seguidos.
- Amenazas creíbles.
- Información personal compartida (teléfonos, emails, "agréguenme en @...", etc.).

DEJA PASAR:
- Lenguaje fuerte casual sin destinatario ("qué mierda", "joder", "wtf", "puta locura").
- Bromas, sarcasmo, ironía, debate apasionado entre usuarios.
- Off-topic / conversación normal del chat.
- Memes, exageraciones, "salseo" de fandom.
- Opiniones fuertes pero no agresivas ("este anime es basura", "odio ese personaje").
- Menciones normales: "@usuario hola", "@usuario qué onda".

EJEMPLOS:
- "jodanse" / "vayanse a la mierda" lanzado al chat → eliminar (insulto colectivo agresivo).
- "qué mierda este capítulo" → permitir (expresión, no insulto).
- "puto" usado contra alguien → eliminar.
- "qué puto crack ese personaje" → permitir (admiración).
- "Gays-----------" o "AAAAAAA" → eliminar (spam).
- "no me gustó el final" / "esa escena fue un asco" → permitir (opinión).
- "mi número es 555-1234" → eliminar (info personal).
- "@user crees que…" → permitir (mención normal).

RESPONDE SOLO JSON, sin markdown:
{"allowed": true|false, "severity": "low"|"medium"|"high", "reason": "una frase breve", "category": "spam"|"toxicity"|"hate"|"harassment"|"personal_info"|"offtopic"|"illegal", "action": "allow"|"warn"|"timeout"|"ban"}

action:
- allow → si allowed es true.
- warn → contenido borderline; lenguaje fuerte usado contra alguien pero no extremo.
- timeout → insultos directos, hate speech leve, spam, info personal.
- ban → amenazas creíbles, hate speech severo, comportamiento manifiestamente abusivo.`;
  }

  /**
   * Per-mode "tone": one short sentence that biases the model toward more or
   * less intervention without changing the rule list.
   */
  private getToneForLevel(): string {
    switch (this.moderationLevel) {
      case 'STRICT':
        return 'estricta — ante la duda, modera. Cero tolerancia a insultos y groserías agresivas.';
      case 'MODERATE':
        return 'equilibrada — modera lo claramente ofensivo o spam. Permite el lenguaje fuerte casual.';
      case 'LENIENT':
        return 'permisiva — solo modera lo claramente abusivo (insultos directos, hate speech, amenazas, spam). Permite groserías casuales y debates intensos.';
      case 'PRIVACY_ONLY':
        return 'no moderes contenido conversacional; solo bloquea información personal y spam evidente.';
      default:
        return 'equilibrada.';
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
        action: parsed.action || (parsed.allowed ? 'allow' : 'warn'),
        source: 'llm',
        llmRaw: result,
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
        action: userLevel >= 3 ? 'warn' : 'timeout',
        source: 'fallback',
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
        action: 'warn',
        source: 'fallback',
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
   * Normalizes the message text to neutralize common evasion tricks before
   * pattern-based checks. Returns a canonicalized lowercase string suitable
   * for regex matching; the original is preserved for the LLM path so context
   * isn't lost.
   *
   * Three passes:
   *   1. Unicode confusables (Cyrillic/Greek lookalikes) → Latin.
   *   2. Leetspeak digit/symbol substitutions ONLY when surrounded by
   *      letters, so "imbec1l" → "imbecil" but "1234" stays "1234".
   *   3. Single-char-spacing pattern ("p u t o" → "puto") collapsed when
   *      we see ≥4 single letters separated by single spaces.
   */
  private normalize(text: string): string {
    let out = '';
    for (const ch of text) {
      out += ModerationService.CONFUSABLES[ch] ?? ch;
    }
    out = out.toLowerCase();

    // Leet substitutions only inside word boundaries (letter neighbors).
    out = out.replace(/([a-záéíóúñ])([0-9@$])(?=[a-záéíóúñ])/gi, (_m, a, d) => a + (ModerationService.LEET[d] ?? d));
    out = out.replace(/(^|[^a-záéíóúñ])([0-9@$])(?=[a-záéíóúñ])/gi, (_m, pre, d) => pre + (ModerationService.LEET[d] ?? d));

    // Collapse 4+ single-letter words separated by spaces into one word.
    out = out.replace(/(?:\b[a-záéíóúñ]\b\s+){3,}[a-záéíóúñ]\b/gi, (m) => m.replace(/\s+/g, ''));

    return out.trim();
  }

  /**
   * Catches obvious junk before any LLM call. All pattern checks run against
   * the normalized text so leetspeak / spacing / confusables don't slip
   * through. The original message is what the LLM sees later.
   *
   *   1. 6+ consecutive identical characters → spam ("AAAAA", "-------").
   *   2. Message of 5+ chars containing no letters at all → symbol blast.
   *   3. Same normalized message repeated by the same user within 60s → flood.
   *   4. Word matches the hard-blocklist of slurs → hate speech.
   */
  private runPreLlmChecks(message: string, username: string): ModerationResult | null {
    const trimmed = message.trim();
    const normalized = this.normalize(trimmed);

    if (this.REPEATED_CHAR_RE.test(trimmed)) {
      return {
        isAllowed: false,
        severity: 'medium',
        reason: 'Spam (caracteres repetidos)',
        category: 'spam',
        action: 'timeout',
        source: 'pre_filter',
      };
    }

    if (this.NO_LETTERS_RE.test(trimmed)) {
      return {
        isAllowed: false,
        severity: 'medium',
        reason: 'Spam (mensaje sin contenido legible)',
        category: 'spam',
        action: 'timeout',
        source: 'pre_filter',
      };
    }

    for (const pattern of this.HARD_BLOCKLIST) {
      if (pattern.test(normalized)) {
        return {
          isAllowed: false,
          severity: 'high',
          reason: 'Lenguaje de odio / slur',
          category: 'toxicity',
          action: 'timeout',
          source: 'pre_filter',
        };
      }
    }

    const history = this.userMessageHistory.get(username) ?? [];
    const now = Date.now();
    const dupe = history.find(
      (entry) =>
        now - entry.timestamp <= this.DEDUP_WINDOW_MS &&
        this.normalize(entry.message.trim()) === normalized,
    );
    if (dupe) {
      return {
        isAllowed: false,
        severity: 'medium',
        reason: 'Spam (mensaje duplicado)',
        category: 'spam',
        action: 'timeout',
        source: 'pre_filter',
      };
    }

    return null;
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