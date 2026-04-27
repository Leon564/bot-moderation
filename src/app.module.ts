import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
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
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const uri = config.get<string>('database.uri');
        if (!uri) {
          throw new Error('MONGODB_URI no configurado en .env');
        }
        return { uri };
      },
    }),
    ScheduleModule.forRoot(),
    ChatSocketModule,
    BotModule,
    ChatModule,
  ],
})
export class AppModule {}
