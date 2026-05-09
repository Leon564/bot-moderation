import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { ChatModule } from '../chat/chat.module';
import { StrikesModule } from '../strikes/strikes.module';
import { ActionsModule } from '../actions/actions.module';
import { WhitelistModule } from '../whitelist/whitelist.module';
import { LoggingService } from '../../common/utils/logging.service';

@Module({
  imports: [ChatModule, StrikesModule, ActionsModule, WhitelistModule],
  providers: [BotService, LoggingService],
  exports: [BotService],
})
export class BotModule {}
