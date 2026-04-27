import { Injectable } from '@nestjs/common';
import { ChatSocketService, ChatMessage } from '../chat-socket/chat-socket.service';
import { MessageData } from '../../common/interfaces';

/**
 * Thin wrapper over ChatSocketService.
 *
 * The previous incarnation of this service made HTTP requests against
 * cbox.ws. The new chat backend is purely socket-driven, so this class is
 * now mostly delegation. Kept as a separate service because BotService
 * already depends on it and to give moderation code a single seam to mock
 * in tests.
 */
@Injectable()
export class MessagesService {
  constructor(private readonly chatSocket: ChatSocketService) {}

  /** Normalize an incoming socket payload into the moderation-friendly shape. */
  toDomain(msg: ChatMessage): MessageData {
    return {
      id: msg._id,
      date: msg.createdAt,
      name: msg.authorUsername,
      role: msg.authorRole ?? 'guest',
      message: msg.content,
    };
  }

  /** Send a fire-and-forget chat message. */
  sendMessage(content: string): void {
    this.chatSocket.sendMessage(content);
  }

  /**
   * Send a warning and resolve once the gateway echoes the message back so
   * the caller knows its `_id`. Used by the auto-delete-warning flow that
   * needs to remove its own message ~10s later.
   */
  sendMessageAndAwaitId(content: string, timeoutMs = 5000): Promise<string | null> {
    return this.chatSocket.sendMessageAndAwaitId(content, timeoutMs);
  }

  /** Delete a message by id. Bot role can delete its own + lower-role messages. */
  deleteMessage(messageId: string): boolean {
    if (!messageId) return false;
    this.chatSocket.deleteMessage(messageId);
    return true;
  }

  /**
   * Ban a user. Bot role on the gateway can only target guest/user; admin and
   * superAdmin targets are rejected server-side with an `error` event.
   */
  banUser(
    username: string,
    reason?: string,
    duration: '5m' | '1h' | '1d' | '1w' | 'permanent' = '1h',
  ): void {
    this.chatSocket.banUser(username, reason, duration);
  }

  /** Username the bot logged in as, or null until the auth handshake completes. */
  get botUsername(): string | null {
    return this.chatSocket.username;
  }
}
