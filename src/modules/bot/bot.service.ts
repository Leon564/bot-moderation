import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { MessagesService } from '../chat/messages.service';
import { ModerationService } from '../chat/moderation.service';
import { LoggingService } from '../../common/utils/logging.service';
import { ChatSocketService, ChatMessage } from '../chat-socket/chat-socket.service';
import { StrikesService } from '../strikes/strikes.service';
import { ActionsService } from '../actions/actions.service';

type BanDuration = '5m' | '1h' | '1d' | '1w' | 'permanent';
const VALID_BAN_DURATIONS: BanDuration[] = ['5m', '1h', '1d', '1w', 'permanent'];

@Injectable()
export class BotService implements OnModuleInit {
  private readonly logger = new Logger(BotService.name);
  private openai: OpenAI;
  private moderationPaused = false;
  private pauseEndTime: number | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly chatSocket: ChatSocketService,
    private readonly messagesService: MessagesService,
    private readonly moderationService: ModerationService,
    private readonly loggingService: LoggingService,
    private readonly strikesService: StrikesService,
    private readonly actionsService: ActionsService,
  ) {
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('openai.apiKey'),
      baseURL: this.configService.get<string>('openai.baseURL') || 'https://api.openai.com/v1',
    });
  }

  onModuleInit() {
    this.logger.log('🛡️ Inicializando Moderador Bot Service...');
    this.logger.log(`🛡️ Moderación automática: ${this.configService.get<boolean>('bot.autoModerateAll') ? 'ENABLED' : 'DISABLED'}`);
    this.logger.log(`🗑️ Eliminación automática: ${this.configService.get<boolean>('bot.autoDeleteMessages') ? 'ENABLED' : 'DISABLED'}`);
    this.logger.log(`⚠️ Advertencias públicas: ${this.configService.get<boolean>('bot.sendModerationWarnings') !== false ? 'ENABLED' : 'DISABLED'}`);
    this.logger.log(`🔒 Protección información personal: ${this.configService.get<boolean>('bot.personalInfoProtection') !== false ? 'ENABLED' : 'DISABLED'}`);

    // Subscribe to incoming messages from the chat socket. ChatSocketService
    // already filters out our own echoes, so we only see other users' messages.
    this.chatSocket.onMessage((msg) => {
      this.handleMessage(msg).catch((err) => {
        this.logger.error(`Error procesando mensaje: ${(err as Error).message}`);
      });
    });
  }

  private async handleMessage(msg: ChatMessage): Promise<void> {
    const { id, name, role, message } = this.messagesService.toDomain(msg);

    if (!name || !message) return;
    // Ignore the legacy "aria" exclusion from the cbox era only if it's still
    // around as a username on this chat — harmless to keep.
    if (name.toLowerCase() === 'aria') return;

    // Los bots no interactúan entre ellos. Cualquier mensaje cuyo autor tenga
    // role 'bot' se ignora por completo — sin log, sin interpretación de
    // comandos, sin moderación — para evitar bucles o ruido cruzado.
    if (role === 'bot') return;

    // Persist a log of the message for diagnostics / context.
    await this.loggingService.saveLog(name, message);

    // Moderation control commands (only mods/admins can issue them).
    if (this.isPrivilegedRole(role)) {
      const handled = await this.interpretModerationCommand(message, name, this.getLevelName(role));
      if (handled) return;
    }

    // Skip auto-moderation while paused.
    if (this.moderationPaused) {
      if (this.pauseEndTime && Date.now() >= this.pauseEndTime) {
        this.moderationPaused = false;
        this.pauseEndTime = null;
        this.logger.log('⏰ [MOD-CONTROL] Pausa de moderación expirada — REANUDANDO automáticamente');
        await this.sendModerationStatusMessage('🟢 Moderación REANUDADA automáticamente (tiempo expirado)');
      } else {
        const remainingMs = this.pauseEndTime ? this.pauseEndTime - Date.now() : 0;
        this.logger.log(`⏸️ [MOD-CONTROL] Moderación pausada — mensaje de ${name} no procesado (${this.formatRemainingTime(remainingMs)} restantes)`);
        return;
      }
    }

    const autoModerateAll = this.configService.get<boolean>('bot.autoModerateAll');
    if (!autoModerateAll) return;

    // Don't moderate other staff. Mods/admins/superAdmins are trusted by the
    // chat permission model — moderating them would cause friction with
    // little benefit, and the gateway would refuse most actions against them
    // anyway (mods can't ban or delete admin/superAdmin content). Bots ya
    // salieron arriba con el early return.
    if (['mod', 'admin', 'superAdmin'].includes(role)) {
      return;
    }

    // Runtime whitelist (env MOD_WHITELIST) — trusted regulars that opt out of
    // moderation without needing a chat role.
    const whitelist = this.configService.get<string[]>('bot.whitelist') ?? [];
    if (whitelist.includes(name.toLowerCase())) {
      return;
    }

    this.logger.log(`🛡️ [AUTO-MOD] Moderando mensaje de ${name}...`);

    try {
      const userLevel = this.roleToLevelNumber(role);
      const reputationHint = await this.computeReputationHint(name);
      const moderationResult = await this.moderationService.moderateMessage(
        message,
        name,
        userLevel,
        reputationHint ? { reputationHint } : {},
      );

      if (moderationResult.isAllowed) {
        this.logger.log(`✅ [MOD] Mensaje aprobado de ${name}`);
        return;
      }

      this.logger.log(`🚫 [MOD] Mensaje bloqueado de ${name}: ${moderationResult.reason}`);

      const deleteFn = async (messageId: string): Promise<boolean> =>
        this.messagesService.deleteMessage(messageId);

      const warningMessage = await this.moderationService.executeModeration(
        moderationResult,
        name,
        id,
        deleteFn,
      );

      // Record the strike (if its severity counts) BEFORE composing the warning,
      // so we can either append the (count/threshold) progress or upgrade to a ban.
      const strikeOutcome = await this.strikesService.record(
        name,
        moderationResult.severity,
        moderationResult.reason ?? '',
        moderationResult.category ?? '',
        {
          threshold: this.configService.get<number>('bot.strikes.threshold') ?? 3,
          windowMs: (this.configService.get<number>('bot.strikes.windowHours') ?? 24) * 60 * 60 * 1000,
          countSeverity: ((this.configService.get<string>('bot.strikes.countSeverity') ?? 'medium').toLowerCase() as 'high' | 'medium' | 'all'),
        },
      );

      const sendWarnings = this.configService.get<boolean>('bot.sendModerationWarnings') ?? true;
      const colorPrefix = this.colorPrefix();
      let publicMessage: string | null = warningMessage;

      if (strikeOutcome.reachedThreshold) {
        const duration = await this.getBanDuration(name);
        const banReason = `Acumuló ${strikeOutcome.count} advertencias (${moderationResult.reason ?? 'sin razón'})`;
        this.messagesService.banUser(name, banReason, duration);
        await this.strikesService.clear(name);
        publicMessage = `🔨 ${name}: Ban temporal (${duration}) por acumular ${strikeOutcome.count} advertencias.`;
        this.logger.log(`🔨 [STRIKES] ${name} alcanzó ${strikeOutcome.count} strikes — ban ${duration} aplicado`);
      } else if (warningMessage && strikeOutcome.counted) {
        publicMessage = `${warningMessage} (${strikeOutcome.count}/${strikeOutcome.threshold} advertencias)`;
      }

      if (publicMessage && sendWarnings) {
        const warningId = await this.messagesService.sendMessageAndAwaitId(`${colorPrefix}${publicMessage}`);
        if (warningId) this.scheduleWarningDeletion(warningId);
      }

      // Audit log: every blocked message gets a row, regardless of whether
      // we sent a public warning. Strike-bans are logged as 'ban'; otherwise
      // we log the LLM/pre-filter action verbatim.
      const finalAction: 'warn' | 'timeout' | 'ban' = strikeOutcome.reachedThreshold
        ? 'ban'
        : moderationResult.action === 'allow'
        ? 'warn' // shouldn't reach here given !isAllowed, but be safe
        : moderationResult.action;
      await this.actionsService.log({
        username: name,
        messageContent: message,
        action: finalAction,
        severity: moderationResult.severity,
        reason: moderationResult.reason ?? '',
        category: moderationResult.category,
        source: strikeOutcome.reachedThreshold ? 'strike_ban' : moderationResult.source ?? 'llm',
        llmRaw: moderationResult.llmRaw,
      });
    } catch (error) {
      this.logger.error(`❌ [MOD] Error en moderación automática: ${(error as Error).message}`);
    }
  }

  private scheduleWarningDeletion(messageId: string): void {
    this.logger.log(`⏰ Programando eliminación de advertencia ${messageId} en 10 segundos...`);
    setTimeout(() => {
      this.messagesService.deleteMessage(messageId);
      this.logger.log(`🗑️ Solicitud de eliminación enviada para advertencia ${messageId}`);
    }, 10_000);
  }

  // ── Roles ──────────────────────────────────────────────────────────────

  /**
   * The chat backend exposes string roles. The moderation prompt and command
   * gating still think in terms of numeric "levels" (1=guest, 2=user, 3=mod,
   * 4=admin), so we keep both views and convert at the boundary.
   */
  private roleToLevelNumber(role: string): number {
    switch (role) {
      case 'superAdmin':
      case 'admin':
        return 4;
      case 'mod':
      case 'bot':
        return 3;
      case 'user':
        return 2;
      case 'guest':
      default:
        return 1;
    }
  }

  private getLevelName(role: string): string {
    switch (role) {
      case 'superAdmin':
      case 'admin':
        return 'Adm';
      case 'mod':
      case 'bot':
        return 'Mod';
      case 'user':
        return 'Reg';
      case 'guest':
      default:
        return 'Guest';
    }
  }

  private isPrivilegedRole(role: string): boolean {
    return ['mod', 'admin', 'superAdmin'].includes(role);
  }

  // ── GPT moderation-control commands ────────────────────────────────────

  private async interpretModerationCommand(
    message: string,
    username: string,
    userLevel: string,
  ): Promise<boolean> {
    try {
      const systemPrompt = `Eres un intérprete de comandos para un bot de moderación. Analiza si el mensaje contiene una intención de controlar la moderación del chat.

RESPONDE SOLO CON UNO DE ESTOS FORMATOS JSON:

Para pausar moderación:
{"action": "pause", "duration": NÚMERO, "unit": "minutes|hours|days|weeks", "reason": "motivo opcional"}

Para reanudar moderación:
{"action": "resume", "reason": "motivo opcional"}

Para consultar estado:
{"action": "status"}

Para NO hacer nada (mensaje normal):
{"action": "none"}

EJEMPLOS DE MENSAJES QUE SÍ SON COMANDOS:
- "pausa el bot 30 minutos" → {"action": "pause", "duration": 30, "unit": "minutes"}
- "desactiva la moderación por 2 horas" → {"action": "pause", "duration": 2, "unit": "hours"}
- "pausa moderación 1 día" → {"action": "pause", "duration": 1, "unit": "days"}
- "detén bot 3 días" → {"action": "pause", "duration": 3, "unit": "days"}
- "para moderación 1 semana" → {"action": "pause", "duration": 1, "unit": "weeks"}
- "reactiva el bot" → {"action": "resume"}
- "reanuda moderación" → {"action": "resume"}
- "como está el bot?" → {"action": "status"}
- "estado de moderación" → {"action": "status"}

UNIDADES VÁLIDAS: minutes, hours, days, weeks
IMPORTANTE: Identifica correctamente la unidad de tiempo mencionada en el mensaje.

EJEMPLOS DE MENSAJES QUE NO SON COMANDOS:
- "hola como están" → {"action": "none"}
- "que opinan del anime" → {"action": "none"}
- "alguien vio el episodio" → {"action": "none"}

Analiza: "${message}"`;

      const response = await this.openai.chat.completions.create({
        model: this.configService.get<string>('openai.model') || 'gpt-3.5-turbo',
        messages: [{ role: 'system', content: systemPrompt }],
        max_tokens: 150,
        temperature: 0.1,
      });

      const result = response.choices[0]?.message?.content?.trim();
      if (!result) return false;

      this.logger.log(`🤖 [GPT-COMMAND] Interpretación para "${message}": ${result}`);

      const command = JSON.parse(result);
      if (command.action === 'none') return false;

      return await this.executeInterpretedCommand(command, username, userLevel);
    } catch (error) {
      this.logger.error(`❌ Error interpretando comando con GPT: ${(error as Error).message}`);
      return false;
    }
  }

  private async executeInterpretedCommand(
    command: { action: string; duration?: number; unit?: string; reason?: string },
    username: string,
    userLevel: string,
  ): Promise<boolean> {
    this.logger.log(`🎛️ [MOD-CONTROL] Comando GPT de ${username} (${userLevel}): ${JSON.stringify(command)}`);

    switch (command.action) {
      case 'pause': {
        const duration = command.duration || 30;
        const unit = command.unit || 'minutes';
        let milliseconds: number;
        let timeText: string;

        switch (unit) {
          case 'weeks':
            milliseconds = duration * 7 * 24 * 60 * 60 * 1000;
            timeText = `${duration} semana(s)`;
            break;
          case 'days':
            milliseconds = duration * 24 * 60 * 60 * 1000;
            timeText = `${duration} día(s)`;
            break;
          case 'hours':
            milliseconds = duration * 60 * 60 * 1000;
            timeText = `${duration} hora(s)`;
            break;
          case 'minutes':
          default:
            milliseconds = duration * 60 * 1000;
            timeText = `${duration} minuto(s)`;
            break;
        }

        this.moderationPaused = true;
        this.pauseEndTime = Date.now() + milliseconds;

        const reason = command.reason ? ` (${command.reason})` : '';
        this.logger.log(`⏸️ [MOD-CONTROL] Moderación PAUSADA por ${username} durante ${timeText}${reason}`);
        await this.sendModerationStatusMessage(
          `🔴 Moderación PAUSADA por ${username} durante ${timeText}${reason}`,
        );
        return true;
      }

      case 'resume': {
        this.moderationPaused = false;
        this.pauseEndTime = null;
        const reason = command.reason ? ` (${command.reason})` : '';
        this.logger.log(`▶️ [MOD-CONTROL] Moderación REANUDADA por ${username}${reason}`);
        await this.sendModerationStatusMessage(`🟢 Moderación REANUDADA por ${username}${reason}`);
        return true;
      }

      case 'status': {
        const status = this.moderationPaused ? 'PAUSADA' : 'ACTIVA';
        let statusMessage = `📊 Estado de moderación: ${status}`;
        if (this.moderationPaused && this.pauseEndTime) {
          const remainingMs = this.pauseEndTime - Date.now();
          statusMessage += ` (${this.formatRemainingTime(remainingMs)} restantes)`;
        }
        this.logger.log(`📊 [MOD-CONTROL] Estado consultado por ${username}: ${status}`);
        await this.sendModerationStatusMessage(statusMessage);
        return true;
      }

      default:
        return false;
    }
  }

  // ── Sending helpers ────────────────────────────────────────────────────

  private async sendModerationStatusMessage(message: string): Promise<void> {
    const fullMessage = `${this.colorPrefix()}${message}`;
    this.messagesService.sendMessage(fullMessage);
  }

  private colorPrefix(): string {
    const textColor = this.configService.get<string>('bot.textColor');
    return textColor ? `^#${textColor} ` : '';
  }

  /**
   * Build an optional one-line user-reputation hint to inject into the LLM
   * prompt. Returns null if reputation is disabled or the user has any
   * recent strike — in those cases the LLM gets no hint and decides plainly.
   * The hint biases the model toward `allow` for users with clean recent
   * history, reducing false positives on regulars.
   */
  private async computeReputationHint(username: string): Promise<string | null> {
    const enabled = this.configService.get<boolean>('bot.reputation.enabled') ?? true;
    if (!enabled) return null;
    const days = this.configService.get<number>('bot.reputation.windowDays') ?? 7;
    const windowMs = days * 24 * 60 * 60 * 1000;
    const recentStrikes = await this.strikesService.countActive(username, windowMs);
    if (recentStrikes > 0) return null;
    return `El usuario "${username}" tiene buen historial: 0 advertencias en los últimos ${days} días. Sesgar hacia "allow" salvo evidencia clara de abuso.`;
  }

  /**
   * Pick the ban duration based on how many bans the user has already
   * accumulated inside the ladder window. First ban → first rung, second
   * → second, etc. Once the ladder is exhausted, reuse the last rung.
   *
   * Falls back to STRIKE_BAN_DURATION (legacy single-value config) if
   * BAN_LADDER is empty.
   */
  private async getBanDuration(username: string): Promise<BanDuration> {
    const ladderRaw = this.configService.get<string[]>('bot.banLadder') ?? [];
    const ladder = ladderRaw.filter((d): d is BanDuration => (VALID_BAN_DURATIONS as string[]).includes(d));

    if (ladder.length === 0) {
      const fallback = (this.configService.get<string>('bot.strikes.banDuration') ?? '1h').trim();
      if ((VALID_BAN_DURATIONS as string[]).includes(fallback)) return fallback as BanDuration;
      this.logger.warn(`STRIKE_BAN_DURATION="${fallback}" no es válido. Usando 1h.`);
      return '1h';
    }

    const windowDays = this.configService.get<number>('bot.banLadderWindowDays') ?? 30;
    const windowMs = windowDays * 24 * 60 * 60 * 1000;
    const previousBans = await this.actionsService.countBansInWindow(username, windowMs);

    // previousBans = 0 → first rung; clamp at last rung when exhausted.
    const rungIndex = Math.min(previousBans, ladder.length - 1);
    return ladder[rungIndex];
  }

  private formatRemainingTime(milliseconds: number): string {
    const minutes = Math.ceil(milliseconds / (60 * 1000));
    const hours = Math.ceil(milliseconds / (60 * 60 * 1000));
    const days = Math.ceil(milliseconds / (24 * 60 * 60 * 1000));

    if (milliseconds >= 24 * 60 * 60 * 1000) return `${days} día(s)`;
    if (milliseconds >= 60 * 60 * 1000) return `${hours} hora(s)`;
    return `${minutes} min`;
  }
}
