import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Action, ActionDocument } from './schemas/action.schema';

export interface ActionLogInput {
  username: string;
  messageContent: string;
  action: 'warn' | 'timeout' | 'ban';
  severity: 'low' | 'medium' | 'high';
  reason: string;
  category?: string;
  source?: string;
  llmRaw?: string;
}

/**
 * Append-only audit log of every moderation decision. Reads come later (panel
 * stats, `!mod history`); writes are fire-and-forget — we never block the
 * moderation flow on this.
 */
@Injectable()
export class ActionsService {
  private readonly logger = new Logger(ActionsService.name);

  constructor(
    @InjectModel(Action.name) private readonly actionModel: Model<ActionDocument>,
  ) {}

  /** Persist an action. Errors are logged but never thrown — moderation continues. */
  async log(input: ActionLogInput): Promise<void> {
    try {
      await this.actionModel.create({
        username: input.username,
        messageContent: input.messageContent,
        action: input.action,
        severity: input.severity,
        reason: input.reason,
        category: input.category ?? '',
        source: input.source ?? 'llm',
        llmRaw: input.llmRaw ?? '',
      });
    } catch (err) {
      this.logger.warn(`No se pudo persistir audit log: ${(err as Error).message}`);
    }
  }

  /** Recent actions for a user, newest first. Used later by !mod history. */
  async findRecentByUser(username: string, limit = 20): Promise<ActionDocument[]> {
    return this.actionModel
      .find({ username })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec() as unknown as Promise<ActionDocument[]>;
  }

  /**
   * How many `ban` actions the user accumulated within the given window.
   * Used to pick the next rung on the escalating ban ladder.
   */
  async countBansInWindow(username: string, windowMs: number): Promise<number> {
    const since = new Date(Date.now() - windowMs);
    return this.actionModel.countDocuments({
      username,
      action: 'ban',
      createdAt: { $gte: since },
    });
  }
}
