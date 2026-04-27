/**
 * Domain shape for an incoming message after we normalize it from the
 * socket.io `newMessage` event of the chat backend.
 */
export interface MessageData {
  id: string;          // Mongo _id of the message
  date: string;        // ISO timestamp (createdAt)
  name: string;        // authorUsername
  role: string;        // 'guest' | 'user' | 'mod' | 'admin' | 'superAdmin' | 'bot'
  message: string;     // content
}

/**
 * Roles map cleanly to the cbox-style level names the moderation prompt
 * already uses, so we keep that vocabulary here.
 */
export type ChatRole =
  | 'guest'
  | 'user'
  | 'mod'
  | 'admin'
  | 'superAdmin'
  | 'bot';
