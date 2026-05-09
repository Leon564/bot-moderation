import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type WhitelistEntryDocument = WhitelistEntry & Document;

/**
 * Trusted regulars that bypass auto-moderation without holding a chat role.
 * Stored separately from chat roles so admins can add/remove via chat
 * commands or directly in Mongo without touching role assignments.
 *
 * `username` is always stored in lowercase to match the case-insensitive
 * lookup used in BotService.
 */
@Schema({ collection: 'mod_whitelist', timestamps: { createdAt: true, updatedAt: false } })
export class WhitelistEntry {
  @Prop({ required: true, unique: true, lowercase: true, trim: true, index: true })
  username: string;

  @Prop({ default: '' })
  addedBy: string;

  @Prop({ default: '' })
  note: string;

  @Prop()
  createdAt: Date;
}

export const WhitelistEntrySchema = SchemaFactory.createForClass(WhitelistEntry);
