import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StrikesService } from './strikes.service';
import { Strike, StrikeSchema } from './schemas/strike.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Strike.name, schema: StrikeSchema }]),
  ],
  providers: [StrikesService],
  exports: [StrikesService],
})
export class StrikesModule {}
