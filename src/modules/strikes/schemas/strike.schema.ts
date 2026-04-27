import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type StrikeDocument = Strike & Document;

/**
 * One document per strike event. Active strikes for a user are derived by
 * counting docs where `createdAt` is within the rolling window — no UPDATE
 * race conditions, no manual counter to keep in sync.
 */
@Schema({ collection: 'mod_strikes', timestamps: { createdAt: true, updatedAt: false } })
export class Strike {
  @Prop({ required: true, index: true })
  username: string;

  @Prop({ required: true, enum: ['low', 'medium', 'high'] })
  severity: 'low' | 'medium' | 'high';

  @Prop({ default: '' })
  reason: string;

  @Prop({ default: '' })
  category: string;

  @Prop()
  createdAt: Date;
}

export const StrikeSchema = SchemaFactory.createForClass(Strike);
StrikeSchema.index({ username: 1, createdAt: -1 });
