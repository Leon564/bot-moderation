import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ActionsService } from './actions.service';
import { Action, ActionSchema } from './schemas/action.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Action.name, schema: ActionSchema }]),
  ],
  providers: [ActionsService],
  exports: [ActionsService],
})
export class ActionsModule {}
