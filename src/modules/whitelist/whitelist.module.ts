import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WhitelistService } from './whitelist.service';
import { WhitelistEntry, WhitelistEntrySchema } from './schemas/whitelist.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: WhitelistEntry.name, schema: WhitelistEntrySchema }]),
  ],
  providers: [WhitelistService],
  exports: [WhitelistService],
})
export class WhitelistModule {}
