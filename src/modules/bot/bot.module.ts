import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { ChatModule } from '../chat/chat.module';
import { LoggingService } from '../../common/utils/logging.service';

@Module({
  imports: [ChatModule],
  providers: [BotService, LoggingService],
  exports: [BotService],
})
export class BotModule {}
