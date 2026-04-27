import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BotModule } from './modules/bot/bot.module';
import { ChatModule } from './modules/chat/chat.module';
import { ChatSocketModule } from './modules/chat-socket/chat-socket.module';
import configuration from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    ChatSocketModule,
    BotModule,
    ChatModule,
  ],
})
export class AppModule {}
