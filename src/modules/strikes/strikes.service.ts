import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Strike, StrikeDocument } from './schemas/strike.schema';

export interface StrikeOutcome {
  /** Whether this severity counted toward the strike total. */
  counted: boolean;
  /** Active strikes for the user inside the rolling window after this insert. */
  count: number;
  /** Threshold above which a ban is triggered. */
  threshold: number;
  /** Convenience: count >= threshold. */
  reachedThreshold: boolean;
}

/**
 * Strike persistence. Each strike is its own immutable document; the active
 * count for a user is a query (createdAt within window). Resetting a user
 * after a ban is a `deleteMany`, not a counter mutation, so concurrent
 * inserts can never race.
 */
@Injectable()
export class StrikesService {
  private readonly logger = new Logger(StrikesService.name);

  constructor(
    @InjectModel(Strike.name) private readonly strikeModel: Model<StrikeDocument>,
  ) {}

  /**
   * Record a strike if `severity` qualifies under `countSeverity`. Returns
   * the resulting active count and whether the threshold has been reached.
   */
  async record(
    username: string,
    severity: 'low' | 'medium' | 'high',
    reason: string,
    category: string,
    options: {
      threshold: number;
      windowMs: number;
      countSeverity: 'high' | 'medium' | 'all';
    },
  ): Promise<StrikeOutcome> {
    const qualifies =
      options.countSeverity === 'all'
        ? true
        : options.countSeverity === 'medium'
        ? severity === 'medium' || severity === 'high'
        : severity === 'high';

    if (!qualifies) {
      return { counted: false, count: 0, threshold: options.threshold, reachedThreshold: false };
    }

    try {
      await this.strikeModel.create({ username, severity, reason, category });
    } catch (err) {
      this.logger.error(`No se pudo persistir strike de ${username}: ${(err as Error).message}`);
      // Do not block moderation if Mongo is hiccuping; treat as if it didn't count.
      return { counted: false, count: 0, threshold: options.threshold, reachedThreshold: false };
    }

    const count = await this.countActive(username, options.windowMs);
    return {
      counted: true,
      count,
      threshold: options.threshold,
      reachedThreshold: count >= options.threshold,
    };
  }

  /** How many strikes the user has within the rolling window. */
  async countActive(username: string, windowMs: number): Promise<number> {
    const since = new Date(Date.now() - windowMs);
    return this.strikeModel.countDocuments({
      username,
      createdAt: { $gte: since },
    });
  }

  /** Wipe all strikes for a user — called after issuing a ban so the count restarts. */
  async clear(username: string): Promise<void> {
    await this.strikeModel.deleteMany({ username });
  }
}
