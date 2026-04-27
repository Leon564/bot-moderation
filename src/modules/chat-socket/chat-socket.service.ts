import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { io, Socket } from 'socket.io-client';
import { randomUUID } from 'crypto';

export interface ChatMessage {
  _id: string;
  content: string;
  authorUsername: string;
  authorColor?: string;
  authorAvatar?: string;
  authorRole?: string;
  type: 'text' | 'sticker';
  createdAt: string;
}

/**
 * Single integration point with the chat backend (E:\Dev\chat\backend).
 *
 * Auth is API-key → JWT exchange (POST /api/auth/bot), then a socket.io
 * connection that joins the public chat room as a `bot` role user. The bot
 * inherits mod/bot permissions on the gateway: it can `deleteMessage` and
 * `moderateBan`, but cannot delete or ban admin/superAdmin targets.
 */
@Injectable()
export class ChatSocketService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatSocketService.name);
  private socket: Socket | null = null;
  private jwt: string | null = null;
  private botUsername: string | null = null;
  private messageHandler: ((msg: ChatMessage) => void) | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pendingAcks = new Map<string, { resolve: (id: string | null) => void; timer: NodeJS.Timeout }>();

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    await this.connect();
  }

  onModuleDestroy() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.disconnect();
  }

  /** Register a handler called for every incoming message (excluding our own echoes). */
  onMessage(handler: (msg: ChatMessage) => void) {
    this.messageHandler = handler;
  }

  private async connect(): Promise<void> {
    const apiUrl = this.configService.get<string>('chat.apiUrl')!;
    const apiKey = this.configService.get<string>('chat.apiKey')!;

    if (!apiKey) {
      this.logger.warn('CHAT_API_KEY not set — skipping chat socket connection');
      return;
    }

    try {
      const res = await fetch(`${apiUrl}/api/auth/bot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Auth failed (${res.status}): ${body}`);
      }

      const data = (await res.json()) as { access_token: string; user: { username: string } };
      this.jwt = data.access_token;
      this.botUsername = data.user.username;
      this.logger.log(`✅ Authenticated as bot: ${this.botUsername}`);
    } catch (err) {
      this.logger.error(`Auth error: ${(err as Error).message}`);
      this.scheduleReconnect();
      return;
    }

    const socketUrl = apiUrl.replace('/api', '').replace(/\/$/, '');
    this.socket = io(socketUrl, {
      auth: { token: this.jwt },
      transports: ['websocket'],
      reconnection: false,
    });

    this.socket.on('connect', () => {
      this.logger.log('🔌 Connected to chat socket');
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.socket!.emit('joinChat', { token: this.jwt, username: this.botUsername });
    });

    this.socket.on('joinedChat', (data: { success: boolean }) => {
      if (data.success) {
        this.logger.log(`🤖 Joined chat as ${this.botUsername}`);
      }
    });

    this.socket.on('joinError', (data: { message: string }) => {
      this.logger.error(`joinError: ${data.message}`);
    });

    this.socket.on('newMessage', (msg: ChatMessage & { clientId?: string }) => {
      // Resolve the pending ack for our own send-and-await calls before
      // discarding bot-authored echoes.
      if (msg.clientId) {
        const pending = this.pendingAcks.get(msg.clientId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingAcks.delete(msg.clientId);
          pending.resolve(msg._id);
        }
      }
      if (msg.authorUsername?.toLowerCase() === this.botUsername?.toLowerCase()) return;
      this.messageHandler?.(msg);
    });

    this.socket.on('disconnect', (reason: string) => {
      this.logger.warn(`Disconnected: ${reason}`);
      this.scheduleReconnect();
    });

    this.socket.on('connect_error', (err: Error) => {
      this.logger.error(`connect_error: ${err.message}`);
      this.scheduleReconnect();
    });

    // Surface gateway errors (perm denials, etc.) for diagnosis
    this.socket.on('error', (data: { message?: string }) => {
      this.logger.warn(`gateway error: ${data?.message ?? JSON.stringify(data)}`);
    });
  }

  private scheduleReconnect(delayMs = 5000) {
    if (this.reconnectTimer) return;
    this.logger.log(`Reconnecting in ${delayMs / 1000}s…`);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      this.socket?.disconnect();
      this.socket = null;
      await this.connect();
    }, delayMs);
  }

  /** Send a text message, fire-and-forget. */
  sendMessage(content: string): void {
    if (!this.socket?.connected) {
      this.logger.warn('Cannot send message — not connected');
      return;
    }
    this.socket.emit('sendMessage', { content, type: 'text' });
  }

  /**
   * Send a message and wait for the gateway to broadcast it back so the caller
   * learns its `_id`. Used for warning messages that need to be auto-deleted
   * later — without the id, we'd be unable to find the message.
   */
  sendMessageAndAwaitId(content: string, timeoutMs = 5000): Promise<string | null> {
    if (!this.socket?.connected) {
      this.logger.warn('Cannot send message — not connected');
      return Promise.resolve(null);
    }
    const clientId = randomUUID();

    return new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingAcks.delete(clientId);
        resolve(null);
      }, timeoutMs);
      this.pendingAcks.set(clientId, { resolve, timer });
      this.socket!.emit('sendMessage', { content, type: 'text', clientId });
    });
  }

  /** Delete a message by id. Bot role can delete its own + lower-role messages. */
  deleteMessage(messageId: string): void {
    if (!this.socket?.connected || !messageId) return;
    this.socket.emit('deleteMessage', { messageId });
  }

  /**
   * Ban a user. Bot role can only ban guest/user. `duration` accepts the
   * gateway's vocabulary: '5m', '1h', '1d', '1w', or 'permanent'.
   */
  banUser(username: string, reason?: string, duration: '5m' | '1h' | '1d' | '1w' | 'permanent' = '1h'): void {
    if (!this.socket?.connected || !username) return;
    this.socket.emit('moderateBan', { username, reason: reason ?? '', duration });
  }

  get isConnected(): boolean {
    return !!this.socket?.connected;
  }

  get username(): string | null {
    return this.botUsername;
  }
}
