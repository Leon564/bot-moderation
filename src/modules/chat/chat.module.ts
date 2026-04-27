import { Module } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { ModerationService } from './moderation.service';
import { ChatSocketModule } from '../chat-socket/chat-socket.module';

@Module({
  imports: [ChatSocketModule],
  providers: [MessagesService, ModerationService],
  exports: [MessagesService, ModerationService, ChatSocketModule],
})
export class ChatModule {}
