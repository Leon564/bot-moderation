import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ActionDocument = Action & Document;

/**
 * Immutable audit log: one document per moderation decision (warn / timeout /
 * ban / personal_info_block). The original message and the LLM's raw response
 * are kept so a human can later review why the bot acted.
 */
@Schema({ collection: 'mod_actions', timestamps: { createdAt: true, updatedAt: false } })
export class Action {
  @Prop({ required: true, index: true })
  username: string;

  @Prop({ required: true })
  messageContent: string;

  @Prop({ required: true, enum: ['warn', 'timeout', 'ban'] })
  action: 'warn' | 'timeout' | 'ban';

  @Prop({ required: true, enum: ['low', 'medium', 'high'] })
  severity: 'low' | 'medium' | 'high';

  @Prop({ default: '' })
  reason: string;

  @Prop({ default: '' })
  category: string;

  /** Origin of the decision: 'pre_filter' | 'llm' | 'fallback' | 'strike_ban'. */
  @Prop({ default: 'llm' })
  source: string;

  /** Raw response text from the LLM (if any). Helpful when reviewing FPs. */
  @Prop({ default: '' })
  llmRaw: string;

  @Prop()
  createdAt: Date;
}

export const ActionSchema = SchemaFactory.createForClass(Action);
ActionSchema.index({ username: 1, createdAt: -1 });
